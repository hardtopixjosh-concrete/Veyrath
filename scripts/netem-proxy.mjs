// TCP proxy that imposes internet-like conditions on a local connection, for testing before a real
// remote session. Delay applies per direction (half the configured RTT each way) with random jitter;
// "loss" is modelled as a retransmission stall on that chunk, which is how packet loss shows up to an
// application over TCP/WebSocket (later data waits behind it — head-of-line blocking).
//
// CLI: node scripts/netem-proxy.mjs --target=7777 --port=7778 --latency=100 --jitter=30 --loss=0.02
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export function startNetemProxy({
  targetHost = '127.0.0.1',
  targetPort,
  port = 0,
  latencyMs = 0,
  jitterMs = 0,
  loss = 0,
  lossPenaltyMs = 250,
}) {
  const sockets = new Set();
  const stats = { connections: 0, chunks: 0, stalls: 0 };

  function pipeDelayed(from, to) {
    // One FIFO per direction drained by a single timer: separate timers that come due together are
    // not guaranteed to fire in order, and TCP never reorders.
    const queue = [];
    let lastRelease = 0;
    let timer = null;
    let ended = false;

    const drain = () => {
      timer = null;
      const now = performance.now();
      while (queue.length && queue[0].release <= now) {
        const { chunk } = queue.shift();
        if (!to.destroyed) to.write(chunk);
      }
      if (queue.length) schedule();
      else if (ended && !to.destroyed) to.end();
    };
    const schedule = () => {
      if (timer || !queue.length) return;
      timer = setTimeout(drain, Math.max(0, queue[0].release - performance.now()));
    };

    from.on('data', (chunk) => {
      const now = performance.now();
      let delay = latencyMs / 2 + ((Math.random() * 2 - 1) * jitterMs) / 2;
      if (loss > 0 && Math.random() < loss) {
        delay += lossPenaltyMs;
        stats.stalls++;
      }
      stats.chunks++;
      const release = Math.max(now + Math.max(0, delay), lastRelease);
      lastRelease = release;
      queue.push({ release, chunk });
      schedule();
    });
    from.on('end', () => {
      ended = true;
      if (!queue.length && !to.destroyed) to.end();
    });
  }

  const server = net.createServer((client) => {
    stats.connections++;
    const upstream = net.connect(targetPort, targetHost);
    for (const s of [client, upstream]) {
      s.setNoDelay(true);
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    }
    const destroyBoth = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', destroyBoth);
    upstream.on('error', destroyBoth);
    client.on('close', () => setTimeout(() => upstream.destroy(), latencyMs + lossPenaltyMs));
    upstream.on('close', () => setTimeout(() => client.destroy(), latencyMs + lossPenaltyMs));
    pipeDelayed(client, upstream);
    pipeDelayed(upstream, client);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        stats,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) =>
    Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
  const proxy = await startNetemProxy({
    targetPort: arg('target', 7777),
    port: arg('port', 7778),
    latencyMs: arg('latency', 100),
    jitterMs: arg('jitter', 20),
    loss: arg('loss', 0),
  });
  console.log(
    `netem proxy ws://127.0.0.1:${proxy.port} -> 127.0.0.1:${arg('target', 7777)} ` +
      `(RTT ${arg('latency', 100)} ms ± ${arg('jitter', 20)} ms, stall rate ${arg('loss', 0)})`,
  );
}
