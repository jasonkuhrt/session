import { startServer } from './http.ts';

const args = process.argv.slice(2);
let directory = process.cwd();
let port = 3210;

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]!;
  if (argument === '--port') {
    const value = args[index + 1];
    if (value === undefined || !Number.isInteger(Number(value))) {
      throw new Error('--port requires an integer.');
    }
    port = Number(value);
    index += 1;
  } else {
    directory = argument;
  }
}

const server = await startServer({ directory, port });
console.log(`Session app: http://${server.hostname}:${server.port}`);
console.log(`Files: ${directory}`);
