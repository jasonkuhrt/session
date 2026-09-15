import { join, resolve } from 'node:path';
import { spawn } from 'bun';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';

/**
 * The address the board is reached at.
 *
 * A [portless](https://github.com/vercel-labs/portless) proxy on this machine
 * serves local ports by name, so the daemon registers itself as the `session`
 * alias and the board is `https://session.localhost/` instead of a port. The
 * proxy belongs to the machine rather than to this tool: other things are
 * behind it, it chooses its own port, scheme and bind mode, and starting one
 * is a decision about the machine and what it exposes. So this reads its state
 * and changes nothing but the one route that names this daemon.
 *
 * Every part of the address comes from portless's own state directory and none
 * of it is inferred from the rest, because an address that does not reach the
 * board is worse than a plain one. When the alias cannot be used, the answer
 * carries the sentence that says why and `session open` prints it beside the
 * port it fell back to: a silent fallback is how a person is left believing
 * the proxy is working.
 */

const repositoryRoot = resolve(import.meta.dir, '../..');

/** The name this daemon registers under; portless adds one hostname per TLD it serves. */
const aliasName = 'session';

/** Written while a proxy runs, and removed when it stops. */
const pidFile = 'proxy.pid';
const portFile = 'proxy.port';

/** Present only while the running proxy is serving TLS. */
const tlsFile = 'proxy.tls';

/** The hostname-to-port table, which outlives any one proxy. */
const routesFile = 'routes.json';

const RoutesJson = Schema.Struct({ hostname: Schema.String, port: Schema.Int }).pipe(
  Schema.Array,
  Schema.fromJsonString,
);

type Route = { readonly hostname: string; readonly port: number };

/** Where the board can be reached, and why it is not the nicer address. */
export type BoardAddress = {
  /** Origin only: no path and no trailing slash. */
  readonly origin: string;
  /**
   * One sentence, whenever the origin is the daemon's own port and portless
   * could have served it by name. Null when the alias is in use, and null when
   * portless is not on this machine at all, where a remark about it would be
   * noise on every open.
   */
  readonly notice: string | null;
};

/** What portless's state directory says at one moment. */
type State = {
  /** The route naming this daemon, whatever port it points at. */
  readonly route: Route | null;
  readonly running: boolean;
  /** The port a running proxy listens on; null when it recorded none. */
  readonly listening: number | null;
  readonly tls: boolean;
};

/**
 * portless keeps its whole state in one directory and reads this same variable
 * to find it, so a proxy started with a directory of its own is still followed
 * here (`resolveStateDir`, portless `src/cli-utils.ts`).
 */
const stateDirectory = Effect.gen(function*() {
  const configured = yield* Config.String('PORTLESS_STATE_DIR').pipe(Config.option);
  if (Option.isSome(configured) && configured.value.trim() !== '') return configured.value;
  return join(yield* Config.String('HOME'), '.portless');
});

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A whole number a file holds, or null when it holds nothing usable. */
const numberIn = (contents: Option.Option<string>): number | null => {
  if (Option.isNone(contents)) return null;
  const value = Number(contents.value.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
};

const readState = (directory: string) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const read = (name: string) => fs.readFileString(join(directory, name)).pipe(Effect.option);
    const routes = yield* read(routesFile).pipe(
      Effect.flatMap((contents) =>
        Option.isNone(contents)
          ? Effect.succeedNone
          : Schema.decodeEffect(RoutesJson)(contents.value).pipe(Effect.option)
      ),
    );
    const named = Option.isNone(routes)
      ? undefined
      : routes.value.find((entry) => entry.hostname.split('.')[0] === aliasName);
    const pid = numberIn(yield* read(pidFile));
    return {
      route: named === undefined ? null : { hostname: named.hostname, port: named.port },
      running: pid !== null && processAlive(pid),
      listening: numberIn(yield* read(portFile)),
      tls: yield* fs.exists(join(directory, tlsFile)),
    } satisfies State;
  });

/**
 * Register the alias. It is a line in a file rather than anything live, so it
 * is worth writing whether or not a proxy is up: the next proxy to start reads
 * the table, and the board answers to its name from that moment.
 */
const registerAlias = (directory: string, port: number) =>
  Effect.tryPromise(() =>
    spawn([process.execPath, 'x', 'portless', 'alias', aliasName, String(port), '--force'], {
      cwd: repositoryRoot,
      env: { ...process.env, PORTLESS_STATE_DIR: directory },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    }).exited
  ).pipe(Effect.ignore);

/**
 * The URL a hostname is served at, by portless's own rule: the scheme is what
 * the TLS marker says and never what the port suggests, and the port is part
 * of the URL unless it is that scheme's default (`formatUrl`, portless
 * `src/utils.ts`). Deriving either from the other is how a printed address
 * quietly stops matching the proxy that serves it.
 */
const originOf = (hostname: string, port: number, tls: boolean): string => {
  const scheme = tls ? 'https' : 'http';
  return port === (tls ? 443 : 80) ? `${scheme}://${hostname}` : `${scheme}://${hostname}:${port}`;
};

/** Which address this state leaves the board at, and what a reader is owed about it. */
const addressIn = (state: State, port: number, ownPort: string): BoardAddress => {
  const registered = state.route !== null && state.route.port === port;
  if (!state.running) {
    return {
      origin: ownPort,
      notice: registered && state.route !== null
        ? `No portless proxy is running, so this is the daemon's own port; with one up the board is at ${state.route.hostname}.`
        : `No portless proxy is running and the ${aliasName} alias could not be registered, so this is the daemon's own port.`,
    };
  }
  if (!registered || state.route === null) {
    return {
      origin: ownPort,
      notice:
        `The portless proxy is running but the ${aliasName} alias could not be registered, so this is the daemon's own port. Register it with: portless alias ${aliasName} ${port} --force`,
    };
  }
  if (state.listening === null) {
    return {
      origin: ownPort,
      notice:
        `The portless proxy is running but has not recorded which port it listens on, so this is the daemon's own port.`,
    };
  }
  return { origin: originOf(state.route.hostname, state.listening, state.tls), notice: null };
};

export const publicOrigin = (
  port: number,
): Effect.Effect<BoardAddress, never, FileSystem.FileSystem> => {
  const ownPort = `http://127.0.0.1:${port}`;
  return Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* stateDirectory;
    // No state directory at all: portless is not part of this machine, and the
    // daemon's own port is simply what this board's address is.
    if (!(yield* fs.exists(directory))) return { origin: ownPort, notice: null };

    const state = yield* readState(directory);
    if (state.route !== null && state.route.port === port) return addressIn(state, port, ownPort);
    // One registration, redone only when the alias is missing or the port moved.
    yield* registerAlias(directory, port);
    return addressIn(yield* readState(directory), port, ownPort);
  }).pipe(
    // Reading someone else's state directory can fail in ways this cannot
    // name. The daemon's own port is still the true address, and the reader is
    // told the nicer one could not be worked out rather than left wondering.
    Effect.orElseSucceed(() => ({
      origin: ownPort,
      notice: "The portless state could not be read, so this is the daemon's own port.",
    })),
  );
};
