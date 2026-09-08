import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import type { Session, Stage } from '../contract.ts';
import { createRequestHandler } from './http.ts';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test('the HTTP boundary enforces origin, validation, and revisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'session-http-'));
  directories.push(directory);
  for (const stage of ['TRIAGE', 'DESIGN', 'BATCH', 'EXECUTE'] satisfies Stage[]) {
    await writeFile(join(directory, `${stage}.md`), '');
  }
  await mkdir(join(directory, 'context'));
  await mkdir(join(directory, 'ignore'));
  await writeFile(join(directory, 'context/research.md'), '# Research');
  await writeFile(join(directory, 'ignore/private.md'), '# Private');
  await symlink('../ignore/private.md', join(directory, 'context/private-link.md'));
  const request = await createRequestHandler({
    directory,
    worktree: { name: 'fixture', path: directory, branch: 'test' },
  });
  const initial = await request(new Request('http://127.0.0.1/api/session'));
  const session = (await initial.json()) as Session;
  const supportingFile = await request(
    new Request('http://127.0.0.1/files/context/research.md'),
  );
  const excludedFile = await request(
    new Request('http://127.0.0.1/files/ignore/private.md'),
  );
  const disguisedExcludedFile = await request(
    new Request('http://127.0.0.1/files/context/private-link.md'),
  );

  const crossOrigin = await request(
    new Request('http://127.0.0.1/api/item', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://other.example' },
      body: '{}',
    }),
  );
  const invalid = await request(
    new Request('http://127.0.0.1/api/item', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stage: 'TRIAGE',
        id: 'T-1',
        title: 'One',
        body: 'Missing the required section.',
        revision: session.revision,
      }),
    }),
  );
  const stale = await request(
    new Request('http://127.0.0.1/api/item', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stage: 'TRIAGE',
        id: 'T-1',
        title: 'One',
        body: '### Decision\nKeep it.',
        revision: 'stale',
      }),
    }),
  );

  expect(initial.status).toBe(200);
  expect(session.worktree).toEqual({ name: 'fixture', path: directory, branch: 'test' });
  expect([supportingFile.status, await supportingFile.text()]).toEqual([200, '# Research']);
  expect(excludedFile.status).toBe(404);
  expect(disguisedExcludedFile.status).toBe(404);
  expect(crossOrigin.status).toBe(403);
  expect(invalid.status).toBe(400);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ error: 'Session changed on disk. Reload before saving.' });
});
