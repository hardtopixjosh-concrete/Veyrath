// Long-running stability test: N headless bot players in one room on the real server process, with
// periodic connection drops (→ rejoin) and leave/join churn, optionally through the netem proxy.
// Usage: node scripts/soak.mjs [--minutes=30] [--bots=5] [--latency=MS --jitter=MS --loss=RATE]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { root, sleep, startServer } from './lib.mjs';
import { startNetemProxy } from './netem-proxy.mjs';

const WebSocket = createRequire(import.meta.url)('ws');
const num = (name, fallback) =>
  Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const minutes = num('minutes', 30);
const botCount = Math.min(5, Math.max(2, num('bots', 5)));
const impairment = {
  latencyMs: num('latency', 0),
  jitterMs: num('jitter', 0),
  loss: num('loss', 0),
};
const PROTOCOL_VERSION = 2;
const port = 18000 + Math.floor(Math.random() * 1000);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logsDir = resolve(root, 'logs');
mkdirSync(logsDir, { recursive: true });
const metricsFile = resolve(logsDir, `soak-${stamp}-metrics.jsonl`);
const summaryFile = resolve(logsDir, `soak-${stamp}.json`);

const counters = {
  rejoinAttempts: 0,
  rejoinSuccesses: 0,
  rejoinSamePlayer: 0,
  leaveJoinCycles: 0,
  joinSuccesses: 0,
  unexpectedErrors: [],
  unexpectedCloses: 0,
};

class Bot {
  constructor(index) {
    this.index = index;
    this.name = `Bot${index}`;
    this.seq = 0;
    this.pingId = 0;
    this.snapshots = 0;
    this.rtt = null;
    this.ws = null;
    this.welcome = null;
    this.timers = [];
    this.dir = { x: 1, y: 0 };
    this.expectClose = false;
  }

  connect(url, first) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      this.expectClose = false;
      const timeout = setTimeout(() => reject(new Error(`${this.name}: no welcome`)), 15_000);
      ws.on('open', () => ws.send(JSON.stringify(first)));
      ws.on('message', (data) => {
        const m = JSON.parse(data.toString());
        if (m.t === 'welcome') {
          clearTimeout(timeout);
          this.welcome = m;
          this.startTimers();
          resolve(m);
        } else if (m.t === 'snapshot') {
          this.snapshots++;
        } else if (m.t === 'pong') {
          this.rtt = performance.now() - m.clientTime;
        } else if (m.t === 'error') {
          if (counters.unexpectedErrors.length < 50) {
            counters.unexpectedErrors.push(`${this.name}: ${m.code} ${m.message}`);
          }
          if (m.t === 'error' && !this.welcome) {
            clearTimeout(timeout);
            reject(new Error(`${this.name}: ${m.code}`));
          }
        }
      });
      ws.on('close', () => {
        this.stopTimers();
        if (!this.expectClose) counters.unexpectedCloses++;
      });
      ws.on('error', () => {});
    });
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  startTimers() {
    this.stopTimers();
    this.timers.push(
      setInterval(() => {
        if (Math.random() < 0.03) {
          const a = Math.random() * Math.PI * 2;
          this.dir = {
            x: Math.round(Math.cos(a) * 100) / 100,
            y: Math.round(Math.sin(a) * 100) / 100,
          };
        }
        this.send({
          t: 'input',
          seq: ++this.seq,
          moveX: this.dir.x,
          moveY: this.dir.y,
          attack: Math.random() < 0.2,
        });
      }, 1000 / 30),
      setInterval(
        () => this.send({ t: 'ping', id: this.pingId++, clientTime: performance.now() }),
        1000,
      ),
      setInterval(() => {
        const r = Math.round((this.rtt ?? 0) * 10) / 10;
        this.send({
          t: 'stats',
          fps: 60,
          rttMs: r,
          rttJitterMs: 0,
          snapshotsPerSec: 30,
          snapshotJitterMs: 0,
          maxSnapshotGapMs: 0,
          corrections: 0,
          reconnects: 0,
        });
      }, 5000),
    );
  }

  stopTimers() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  async create(url) {
    return this.connect(url, { t: 'create', v: PROTOCOL_VERSION, name: this.name });
  }

  async join(url, room) {
    return this.connect(url, { t: 'join', v: PROTOCOL_VERSION, name: this.name, room });
  }

  /** Abrupt network loss, then rejoin with the held token. */
  async dropAndRejoin(url) {
    const { room, playerId, token } = this.welcome;
    this.expectClose = true;
    this.ws.terminate();
    await sleep(1000 + Math.random() * 2000);
    counters.rejoinAttempts++;
    const w = await this.connect(url, { t: 'rejoin', v: PROTOCOL_VERSION, room, playerId, token });
    counters.rejoinSuccesses++;
    if (w.playerId === playerId) counters.rejoinSamePlayer++;
  }

  async leave() {
    this.expectClose = true;
    this.send({ t: 'leave' });
    await sleep(200);
    this.ws?.close();
    this.stopTimers();
  }
}

const health = [];
async function sampleHealth() {
  try {
    const h = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    health.push({ at: Date.now(), ...h });
  } catch {
    // ignore
  }
}

console.log(
  `soak: ${botCount} bots for ${minutes} min` +
    (impairment.latencyMs || impairment.jitterMs || impairment.loss
      ? ` through netem (RTT ${impairment.latencyMs}±${impairment.jitterMs} ms, stalls ${impairment.loss})`
      : ''),
);
const server = await startServer({
  port,
  env: {
    VEYRATH_METRICS_FILE: metricsFile,
    VEYRATH_RECONNECT_GRACE_MS: '15000',
    VEYRATH_LOG_LEVEL: 'info',
  },
  onLine: (l) => {
    if (/ (WARN|ERROR) /.test(l)) console.log(l);
  },
});
const impaired = impairment.latencyMs > 0 || impairment.jitterMs > 0 || impairment.loss > 0;
const proxy = impaired ? await startNetemProxy({ targetPort: port, ...impairment }) : null;
const url = `ws://127.0.0.1:${proxy ? proxy.port : port}`;

const bots = Array.from({ length: botCount }, (_, i) => new Bot(i));
const { room } = await bots[0].create(url);
for (const b of bots.slice(1)) await b.join(url, room);
console.log(`soak: room ${room} with ${botCount} bots`);

const startedAt = Date.now();
const endAt = startedAt + minutes * 60_000;
const healthTimer = setInterval(sampleHealth, 5000);
await sampleHealth();

let cycle = 0;
let failure = null;
while (Date.now() < endAt && !failure) {
  await sleep(Math.min(60_000, Math.max(0, endAt - Date.now())));
  if (Date.now() >= endAt) break;
  cycle++;
  const bot = bots[1 + (cycle % (botCount - 1))];
  try {
    if (cycle % 2 === 1) {
      await bot.dropAndRejoin(url);
    } else {
      await bot.leave();
      counters.leaveJoinCycles++;
      const fresh = new Bot(bot.index);
      bots[bot.index] = fresh;
      await fresh.join(url, room);
      counters.joinSuccesses++;
    }
  } catch (err) {
    failure = String(err);
  }
  const h = health.at(-1);
  const elapsed = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(
    `soak: ${elapsed} min · ticks ${h?.ticks} · maxTick ${h?.maxTickMs?.toFixed(2)} ms · ` +
      `heap ${h?.heapUsedMB} MB · rss ${h?.rssMB} MB · players ${h?.members} · conns ${h?.connections}`,
  );
}

const botStats = bots.map((b) => ({ name: b.name, rttMs: b.rtt, snapshots: b.snapshots }));
for (const b of bots) await b.leave();
await sleep(1500);
await sampleHealth();
clearInterval(healthTimer);
await proxy?.close();
server.kill('SIGINT');
await Promise.race([server.exited, sleep(4000)]);
server.kill();

// ---- evaluation --------------------------------------------------------------------------------
const first = health[0];
const lastRunning = health.filter((h) => h.at <= endAt).at(-1);
const final = health.at(-1);
const tickHz =
  lastRunning && first
    ? ((lastRunning.ticks - first.ticks) * 1000) / (lastRunning.at - first.at)
    : 0;
const heapEarly = health
  .filter((h) => h.at - startedAt < 3 * 60_000 && h.at - startedAt > 30_000)
  .map((h) => h.heapUsedMB);
const heapLate = health
  .filter((h) => endAt - h.at < 3 * 60_000 && h.at <= endAt)
  .map((h) => h.heapUsedMB);
const median = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : null);
const maxTick = Math.max(...health.map((h) => h.maxTickMs ?? 0));
const checks = [
  ['tick rate held at ~30 Hz', tickHz >= 29.5, `${tickHz.toFixed(2)} Hz over ${minutes} min`],
  [
    'no tick-loop resets',
    (lastRunning?.behindResets ?? 1) === 0,
    `behindResets ${lastRunning?.behindResets}`,
  ],
  ['worst tick < 20 ms', maxTick < 20, `${maxTick.toFixed(2)} ms`],
  [
    'every drop rejoined as the same player',
    counters.rejoinAttempts > 0 && counters.rejoinSamePlayer === counters.rejoinAttempts,
    `${counters.rejoinSamePlayer}/${counters.rejoinAttempts}`,
  ],
  [
    'every leave → new join succeeded',
    counters.joinSuccesses === counters.leaveJoinCycles,
    `${counters.joinSuccesses}/${counters.leaveJoinCycles}`,
  ],
  [
    'no unexpected disconnects or errors',
    counters.unexpectedCloses === 0 && counters.unexpectedErrors.length === 0,
    `closes ${counters.unexpectedCloses}, errors ${counters.unexpectedErrors.length}`,
  ],
  [
    'heap stable (late median ≤ early median + 20 MB)',
    median(heapEarly) !== null &&
      median(heapLate) !== null &&
      median(heapLate) <= median(heapEarly) + 20,
    `early ${median(heapEarly)} MB → late ${median(heapLate)} MB`,
  ],
  [
    'clean shutdown state',
    final && final.rooms === 0 && final.connections === 0,
    `rooms ${final?.rooms}, connections ${final?.connections}`,
  ],
  ['harness completed', failure === null, failure ?? 'ok'],
];

console.log('\n================ soak results ================');
for (const [name, pass, evidence] of checks)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${evidence}`);
console.log(`bots: ${botStats.map((b) => `${b.name} rtt ${b.rttMs?.toFixed(1)} ms`).join(', ')}`);
writeFileSync(
  summaryFile,
  JSON.stringify({ minutes, botCount, impairment, counters, checks, botStats, health }, null, 2),
);
console.log(`\nSummary: ${summaryFile}\nMetrics: ${metricsFile}`);
process.exit(checks.every(([, pass]) => pass) ? 0 : 1);
