// Hosts a friend-test server on this PC's Tailscale address and records metrics to logs/.
//
//   node scripts/host.mjs                 bind to this PC's Tailscale IP (100.x.y.z)
//   node scripts/host.mjs --client        ...and also open your own game window
//   node scripts/host.mjs --lan           bind to all interfaces instead (home LAN testing)
//   node scripts/host.mjs --host=IP       bind to a specific address
//   node scripts/host.mjs --port=7777
//
// Stop with Ctrl+C. The metrics file path is printed at start and end.
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { clientCommand, root, sleep, startProcess, startServer } from './lib.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const flag = (name) => process.argv.includes(`--${name}`);

/** Tailscale hands out addresses from the CGNAT range 100.64.0.0/10. */
function tailscaleAddress() {
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [first, second] = a.address.split('.').map(Number);
      if (first === 100 && second >= 64 && second <= 127) return { name, address: a.address };
    }
  }
  return null;
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

const port = Number(arg('port') ?? 7777);
let bindHost;
let shareHosts;
if (arg('host')) {
  bindHost = arg('host');
  shareHosts = [bindHost];
} else if (flag('lan')) {
  bindHost = '0.0.0.0';
  shareHosts = lanAddresses();
} else {
  const ts = tailscaleAddress();
  if (!ts) {
    console.error(
      'No Tailscale address (100.64.x.x–100.127.x.x) found on this PC.\n' +
        'Install Tailscale, sign in, and check that `tailscale ip -4` prints an address.\n' +
        'For a same-network test use --lan; to pick an address yourself use --host=IP.',
    );
    process.exit(1);
  }
  bindHost = ts.address;
  shareHosts = [ts.address];
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logsDir = resolve(root, 'logs');
mkdirSync(logsDir, { recursive: true });
const metricsFile = resolve(logsDir, `metrics-${stamp}.jsonl`);

const server = await startServer({
  port,
  env: { VEYRATH_HOST: bindHost, VEYRATH_METRICS_FILE: metricsFile },
});
const urls = shareHosts.map((h) => `ws://${h}:${port}`);
console.log('\n================ Veyrath host ================');
console.log(`Server address for your friend:  ${urls.join('   or   ')}`);
console.log(`Metrics file:                    ${metricsFile}`);
console.log(
  'Windows may ask whether Node.js may accept connections: allow it on Private networks.',
);
console.log('Stop with Ctrl+C.\n');

let client = null;
if (flag('client')) {
  const { cmd, args } = clientCommand(flag('packaged'));
  client = startProcess('client', cmd, [...args, '--instance=1', `--server=${urls[0]}`]);
}

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  client?.kill();
  // Ctrl+C reaches the server too and it shuts down cleanly (flushing metrics); force it if not.
  const exited = await Promise.race([
    server.exited.then(() => true),
    sleep(4000).then(() => false),
  ]);
  if (!exited) server.kill();
  console.log(`\nMetrics saved to ${metricsFile}`);
  console.log(`Summarize with:  npm run metrics:report -- "${metricsFile}"`);
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.exited.then(() => {
  if (!stopping) {
    console.error('server exited unexpectedly');
    void stop();
  }
});
