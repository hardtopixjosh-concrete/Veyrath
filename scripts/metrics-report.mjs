// Summarizes a server metrics file (JSON lines) from a test session.
// Usage: node scripts/metrics-report.mjs logs/metrics-....jsonl [--json]
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/metrics-report.mjs <metrics.jsonl> [--json]');
  process.exit(1);
}
const records = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

function summarize(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const pick = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  return { n: v.length, min: v[0], avg: Math.round(avg * 10) / 10, p95: pick(0.95), max: v.at(-1) };
}
const fmt = (s) =>
  s ? `avg ${s.avg}  p95 ${s.p95}  max ${s.max}  (min ${s.min}, n=${s.n})` : 'no data';

const first = records[0]?.at;
const last = records.at(-1)?.at;
const durationMin = first && last ? (Date.parse(last) - Date.parse(first)) / 60000 : 0;
const events = records.filter((r) => r.type === 'event');
const servers = records.filter((r) => r.type === 'server');
const clients = records.filter((r) => r.type === 'client');

const players = new Map();
for (const r of clients) {
  const key = r.player;
  if (!players.has(key)) players.set(key, { name: r.name, room: r.room, rows: [] });
  players.get(key).rows.push(r);
}

const report = {
  file,
  from: first,
  to: last,
  durationMinutes: Math.round(durationMin * 10) / 10,
  server: {
    avgTickMs: summarize(servers.map((r) => r.avgTickMs)),
    maxTickMs: summarize(servers.map((r) => r.maxTickMs)),
    behindResets: servers.at(-1)?.behindResets ?? null,
    rssMB: summarize(servers.map((r) => r.rssMB)),
    heapUsedMB: summarize(servers.map((r) => r.heapUsedMB)),
    skippedSnapshots: servers.at(-1)?.skippedSnapshots ?? null,
    droppedInputs: servers.at(-1)?.droppedInputs ?? null,
    rejectedInputs: servers.at(-1)?.rejectedInputs ?? null,
    invalidMessages: servers.at(-1)?.invalidMessages ?? null,
    rateLimitDrops: servers.at(-1)?.rateLimitDrops ?? null,
  },
  events: Object.fromEntries(
    [...new Set(events.map((e) => e.event))].map((name) => [
      name,
      events.filter((e) => e.event === name).length,
    ]),
  ),
  players: [...players].map(([id, p]) => ({
    player: id,
    name: p.name,
    room: p.room,
    samples: p.rows.length,
    clientRttMs: summarize(p.rows.map((r) => r.rttMs)),
    serverRttMs: summarize(p.rows.map((r) => r.serverRttMs)),
    rttJitterMs: summarize(p.rows.map((r) => r.rttJitterMs)),
    snapshotsPerSec: summarize(p.rows.map((r) => r.snapshotsPerSec)),
    snapshotJitterMs: summarize(p.rows.map((r) => r.snapshotJitterMs)),
    maxSnapshotGapMs: summarize(p.rows.map((r) => r.maxSnapshotGapMs)),
    fps: summarize(p.rows.map((r) => r.fps)),
    reconnects: Math.max(0, ...p.rows.map((r) => r.reconnects)),
    corrections: Math.max(0, ...p.rows.map((r) => r.corrections)),
    skippedSnapshots: Math.max(0, ...p.rows.map((r) => r.skippedSnapshots ?? 0)),
  })),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log(`Metrics: ${file}`);
console.log(`Span: ${report.from} → ${report.to} (${report.durationMinutes} min)\n`);
console.log('Server');
console.log(`  avg tick ms      ${fmt(report.server.avgTickMs)}`);
console.log(`  max tick ms      ${fmt(report.server.maxTickMs)}`);
console.log(`  memory rss MB    ${fmt(report.server.rssMB)}`);
console.log(`  heap used MB     ${fmt(report.server.heapUsedMB)}`);
console.log(
  `  behind resets ${report.server.behindResets}  skipped snapshots ${report.server.skippedSnapshots}  ` +
    `dropped inputs ${report.server.droppedInputs}  rejected inputs ${report.server.rejectedInputs}  ` +
    `invalid ${report.server.invalidMessages}  rate-limited ${report.server.rateLimitDrops}`,
);
console.log(
  `\nEvents  ${
    Object.entries(report.events)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ') || 'none'
  }`,
);
for (const p of report.players) {
  console.log(`\nPlayer ${p.name} (${p.player}, room ${p.room}) — ${p.samples} samples`);
  console.log(`  client RTT ms       ${fmt(p.clientRttMs)}`);
  console.log(`  server RTT ms       ${fmt(p.serverRttMs)}`);
  console.log(`  RTT jitter ms       ${fmt(p.rttJitterMs)}`);
  console.log(`  snapshots/s         ${fmt(p.snapshotsPerSec)}`);
  console.log(`  snapshot jitter ms  ${fmt(p.snapshotJitterMs)}`);
  console.log(`  max snapshot gap ms ${fmt(p.maxSnapshotGapMs)}`);
  console.log(`  fps                 ${fmt(p.fps)}`);
  console.log(
    `  reconnects ${p.reconnects}  prediction corrections ${p.corrections}  skipped snapshots ${p.skippedSnapshots}`,
  );
}
