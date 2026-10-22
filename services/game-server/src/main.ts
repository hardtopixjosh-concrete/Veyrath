import { PROTOCOL_VERSION } from '@veyrath/protocol';
import { DEFAULT_SIM_CONFIG } from '@veyrath/sim';
import { configFromEnv } from './config';
import { createLogger } from './logger';
import { createFileMetrics, nullMetrics } from './metrics';
import { GameServer } from './server';

async function main(): Promise<void> {
  const config = configFromEnv(process.env);
  const log = createLogger(config.logLevel);
  const metrics = config.metricsFile ? createFileMetrics(config.metricsFile) : nullMetrics;
  const server = new GameServer(config, log, metrics);
  const { host, port } = await server.start();
  log.info('listening', {
    url: `ws://${host}:${port}`,
    health: `http://${host}:${port}/health`,
    protocol: PROTOCOL_VERSION,
    tickRate: DEFAULT_SIM_CONFIG.tickRate,
    snapshotEveryTicks: config.snapshotEveryTicks,
    reconnectGraceMs: config.reconnectGraceMs,
    metrics: config.metricsFile ?? 'off',
    updates: config.updatesDir ?? 'off',
  });
  metrics.write({ type: 'event', event: 'server started', host, port, protocol: PROTOCOL_VERSION });

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal });
    server
      .stop()
      .then(() => {
        metrics.write({ type: 'event', event: 'server stopped', signal });
        return metrics.close();
      })
      .then(
        () => process.exit(0),
        (err: unknown) => {
          log.error('shutdown failed', { error: String(err) });
          process.exit(1);
        },
      );
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
