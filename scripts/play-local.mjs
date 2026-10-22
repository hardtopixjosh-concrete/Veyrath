// Starts the game server and two desktop clients on this PC. Close both windows (or Ctrl+C) to stop.
// Usage: node scripts/play-local.mjs [--packaged] [--clients=N]
import { clientCommand, startProcess, startServer } from './lib.mjs';

const packaged = process.argv.includes('--packaged');
const clientsArg = process.argv.find((a) => a.startsWith('--clients='));
const clientCount = Math.min(5, Math.max(1, Number(clientsArg?.split('=')[1] ?? 2) || 2));
const port = Number(process.env.VEYRATH_PORT ?? 7777);
const url = `ws://127.0.0.1:${port}`;

const server = await startServer({ port });
const { cmd, args } = clientCommand(packaged);
const clients = [];
for (let i = 1; i <= clientCount; i++) {
  clients.push(startProcess(`client${i}`, cmd, [...args, `--instance=${i}`, `--server=${url}`]));
}
console.log(`\n${clientCount} client(s) launched against ${url}.`);
console.log(
  'In window 1: Create room. In window 2: type the room code and Join. F3 = debug overlay.\n',
);

let stopping = false;
const stopAll = () => {
  if (stopping) return;
  stopping = true;
  for (const c of clients) c.kill();
  server.kill();
};
process.on('SIGINT', stopAll);
await Promise.all(clients.map((c) => c.exited));
stopAll();
await server.exited;
