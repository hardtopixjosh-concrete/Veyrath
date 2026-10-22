// Automated Milestone 1 acceptance run with two real Electron clients and the real server process.
//
//   host (window 1): creates a room, autopilots to the enemy and attacks, gets MINIMIZED mid-run
//   join (window 2): joins, autopilots + attacks, renders deliberately slowly (~40 ms/frame),
//                    suffers a simulated network drop and auto-rejoins, then leaves the room
//
// Each client reports what it saw; this script compares the reports and polls the server's /health.
// Usage: node scripts/smoke-two-clients.mjs [--packaged] [--latency=MS --jitter=MS --loss=RATE]
//   --latency/--jitter/--loss route both clients through scripts/netem-proxy.mjs (simulated internet).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startNetemProxy } from './netem-proxy.mjs';
import {
  clientCommand,
  packagedServer,
  root,
  serverBundle,
  sleep,
  startProcess,
  startServer,
} from './lib.mjs';

const packaged = process.argv.includes('--packaged');
const numArg = (name) => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return raw === undefined ? null : Number(raw);
};
const impairment = {
  latencyMs: numArg('latency') ?? 0,
  jitterMs: numArg('jitter') ?? 0,
  loss: numArg('loss') ?? 0,
};
const impaired = impairment.latencyMs > 0 || impairment.jitterMs > 0 || impairment.loss > 0;
const port = 17000 + Math.floor(Math.random() * 1000);
let url = `ws://127.0.0.1:${port}`;
const outDir = resolve(root, '.smoke');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const aOut = resolve(outDir, 'host.jsonl');
const bOut = resolve(outDir, 'join.jsonl');
const logLines = [];
const log = (line) => {
  logLines.push(line);
  console.log(line);
};

const T = {
  hostDuration: 24_000,
  minimizeAt: 7_000,
  minimizeFor: 5_000,
  joinDuration: 16_000,
  dropAt: 8_000,
  leaveAt: 13_000,
  renderDelay: 40,
};

function readReports(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function waitForReport(file, type, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = readReports(file).find((r) => r.type === type);
    if (found) return found;
    await sleep(100);
  }
  throw new Error(`no "${type}" report in ${file} within ${timeoutMs} ms`);
}

const health = [];
async function pollHealth(signal) {
  while (!signal.stopped) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const h = await res.json();
      health.push({ at: Date.now(), ...h });
    } catch {
      // server not up yet / already down
    }
    await sleep(250);
  }
}

log(`smoke: ${packaged ? 'PACKAGED exe' : 'dev Electron build'}, server ${url}`);
const server = await startServer({
  port,
  bundle: packaged ? packagedServer : serverBundle,
  env: {
    VEYRATH_RECONNECT_GRACE_MS: '5000',
    VEYRATH_LOG_LEVEL: 'info',
    VEYRATH_METRICS_FILE: resolve(outDir, 'metrics.jsonl'),
  },
  onLine: log,
});
const proxy = impaired ? await startNetemProxy({ targetPort: port, ...impairment }) : null;
if (proxy) {
  url = `ws://127.0.0.1:${proxy.port}`;
  log(
    `smoke: clients connect through netem proxy ${url} — RTT ${impairment.latencyMs} ms ± ` +
      `${impairment.jitterMs} ms, stall rate ${impairment.loss}`,
  );
}
const pollSignal = { stopped: false };
const poller = pollHealth(pollSignal);
const { cmd, args } = clientCommand(packaged);

let host;
let join;
try {
  host = startProcess(
    'host',
    cmd,
    [
      ...args,
      '--instance=1',
      `--server=${url}`,
      '--smoke=host',
      `--smoke-duration=${T.hostDuration}`,
      `--minimize-at=${T.minimizeAt}`,
      `--minimize-for=${T.minimizeFor}`,
      '--screenshot-at=5000',
      `--smoke-out=${aOut}`,
    ],
    { onLine: log },
  );
  const roomReport = await waitForReport(aOut, 'room', 30_000);
  log(`smoke: host created room ${roomReport.room}; launching second client`);
  join = startProcess(
    'join',
    cmd,
    [
      ...args,
      '--instance=2',
      `--server=${url}`,
      '--smoke=join',
      `--room=${roomReport.room}`,
      `--smoke-duration=${T.joinDuration}`,
      `--render-delay=${T.renderDelay}`,
      `--drop-at=${T.dropAt}`,
      `--leave-at=${T.leaveAt}`,
      '--screenshot-at=6000',
      `--smoke-out=${bOut}`,
    ],
    { onLine: log },
  );
  const exitCodes = await Promise.race([
    Promise.all([host.exited, join.exited]),
    sleep(90_000).then(() => {
      throw new Error('clients did not exit within 90 s');
    }),
  ]);
  log(`smoke: clients exited with codes ${exitCodes.join(', ')}`);
  await sleep(1500);
} finally {
  host?.kill();
  join?.kill();
  pollSignal.stopped = true;
  await poller;
  await proxy?.close();
  server.kill();
  await server.exited;
}

// ---------------------------------------------------------------------------------------------
const A = readReports(aOut);
const B = readReports(bOut);
const aFinal = A.find((r) => r.type === 'final');
const bFinal = B.find((r) => r.type === 'final');
const results = [];
const gate = (name, pass, evidence) => results.push({ name, pass: Boolean(pass), evidence });

if (!aFinal || !bFinal) {
  gate('Both clients produced a final report', false, `host=${!!aFinal} join=${!!bFinal}`);
} else {
  // G1 — shared world, see each other move
  const aSeesB = aFinal.otherPlayers[bFinal.playerId] ?? 0;
  const bSeesA = bFinal.otherPlayers[aFinal.playerId] ?? 0;
  gate(
    'G1 Two distinct clients share one world and see each other move',
    aFinal.room === bFinal.room &&
      aFinal.playerId !== bFinal.playerId &&
      aSeesB > 50 &&
      bSeesA > 50,
    `room ${aFinal.room}; host saw join move ${aSeesB}u, join saw host move ${bSeesA}u`,
  );

  // G2 — both attack the same enemy, identical HP
  const hitters = new Set([...aFinal.enemyHitBy, ...bFinal.enemyHitBy]);
  let common = 0;
  let mismatches = 0;
  for (const [tick, hp] of Object.entries(aFinal.hpByTick)) {
    if (tick in bFinal.hpByTick) {
      common++;
      if (bFinal.hpByTick[tick] !== hp) mismatches++;
    }
  }
  const hpValues = new Set(Object.values(aFinal.hpByTick));
  gate(
    'G2 Both players hit the same enemy and both clients see the same HP',
    hitters.has(aFinal.playerId) &&
      hitters.has(bFinal.playerId) &&
      common > 100 &&
      mismatches === 0 &&
      hpValues.size > 2,
    `hits landed by: ${[...hitters].join(', ')}; ${common} common ticks compared, ${mismatches} HP mismatches; ${hpValues.size} distinct HP values`,
  );

  // G3 — server unaffected by a minimized window and a slow-rendering window
  const minimize = A.find((r) => r.type === 'window' && r.event === 'minimize');
  const restore = A.find((r) => r.type === 'window' && r.event === 'restore');
  let minimizedSeconds = [];
  let serverHz = null;
  if (minimize && restore) {
    minimizedSeconds = aFinal.timeline.filter(
      ([sec]) => sec * 1000 >= minimize.at && (sec + 1) * 1000 <= restore.at,
    );
    const inWindow = health.filter((h) => h.at >= minimize.at && h.at <= restore.at);
    if (inWindow.length >= 2) {
      const first = inWindow[0];
      const last = inWindow[inWindow.length - 1];
      serverHz = ((last.ticks - first.ticks) * 1000) / (last.at - first.at);
    }
  }
  const minSnapRate = minimizedSeconds.length ? Math.min(...minimizedSeconds.map(([, n]) => n)) : 0;
  gate(
    'G3 Server simulation continues normally while one window is minimized and the other renders slowly',
    minimize?.minimized === true &&
      minimizedSeconds.length >= 3 &&
      minSnapRate >= (impaired ? 20 : 25) &&
      serverHz !== null &&
      serverHz >= 28 &&
      bFinal.avgFps < aFinal.avgFps &&
      bFinal.inputsPerSecond >= 27,
    `host minimized=${minimize?.minimized} for ${restore && minimize ? restore.at - minimize.at : '?'} ms; ` +
      `host snapshots/s while minimized: ${minimizedSeconds.map(([, n]) => n).join(',') || 'none'}; ` +
      `server tick rate while minimized: ${serverHz?.toFixed(1) ?? '?'} Hz; ` +
      `avg FPS host ${aFinal.avgFps} vs slow join ${bFinal.avgFps}; ` +
      `input rate host ${aFinal.inputsPerSecond}/s, slow join ${bFinal.inputsPerSecond}/s`,
  );

  results.push({
    name: 'Network as seen by clients (informational)',
    pass: true,
    evidence:
      `RTT host ${aFinal.rttMs} ms (jitter ${aFinal.rttJitterMs}), join ${bFinal.rttMs} ms (jitter ${bFinal.rttJitterMs}); ` +
      `snapshot jitter host ${aFinal.snapshotJitterMs} ms, join ${bFinal.snapshotJitterMs} ms; ` +
      `max snapshot gap host ${aFinal.maxSnapshotGapMs} ms; prediction corrections host ${aFinal.corrections}, join ${bFinal.corrections}` +
      (proxy
        ? `; proxy stalls injected ${proxy.stats.stalls} of ${proxy.stats.chunks} chunks`
        : ''),
  });

  // G4 — drop + rejoin, clean leave, other player unaffected
  const endHealth = health.at(-1);
  gate(
    'G4 Disconnect → automatic rejoin as same player; clean leave; other player stays connected',
    bFinal.rejoinedSamePlayer === true &&
      bFinal.reconnects >= 1 &&
      bFinal.left === true &&
      aFinal.phaseLossesAfterJoin === 0 &&
      aFinal.playersAtEnd === 1,
    `join dropped at ${bFinal.droppedAtMs} ms, rejoined same id: ${bFinal.rejoinedSamePlayer}; ` +
      `left: ${bFinal.left}; host connection interruptions: ${aFinal.phaseLossesAfterJoin}; ` +
      `players in host's world at end: ${aFinal.playersAtEnd}`,
  );
  gate(
    'G5 Server cleaned up after both clients exited',
    endHealth && endHealth.rooms === 0 && endHealth.members === 0 && endHealth.connections === 0,
    endHealth
      ? `rooms ${endHealth.rooms}, players ${endHealth.members}, connections ${endHealth.connections}; ` +
          `rejected inputs ${endHealth.totals.rejectedInputs}, invalid ${endHealth.totals.invalidMessages}, ` +
          `skipped snapshots ${endHealth.totals.skippedSnapshots}, max tick ${endHealth.maxTickMs.toFixed(2)} ms`
      : 'no health data',
  );
  if (aFinal.errors.length || bFinal.errors.length) {
    log(
      `client-reported errors: host=${JSON.stringify(aFinal.errors)} join=${JSON.stringify(bFinal.errors)}`,
    );
  }
}

console.log('\n================ Milestone 1 smoke results ================');
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.evidence}`);
}
writeFileSync(
  resolve(outDir, 'results.json'),
  JSON.stringify({ packaged, impairment, results, health }, null, 2),
);
writeFileSync(resolve(outDir, 'run.log'), logLines.join('\n'));
console.log(
  `\nReports: .smoke/host.jsonl, .smoke/join.jsonl, .smoke/results.json, .smoke/metrics.jsonl, .smoke/run.log`,
);
process.exit(results.length && results.every((r) => r.pass) ? 0 : 1);
