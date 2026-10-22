import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type MetricsRecord = Record<string, string | number | boolean | null | undefined>;

/** Append-only JSON-lines sink for test metrics. One record per line, each with an ISO timestamp. */
export interface MetricsSink {
  write(record: MetricsRecord): void;
  close(): Promise<void>;
}

export const nullMetrics: MetricsSink = {
  write: () => {},
  close: async () => {},
};

export function createFileMetrics(path: string): MetricsSink {
  mkdirSync(dirname(path), { recursive: true });
  const stream = createWriteStream(path, { flags: 'a' });
  let closed = false;
  return {
    write(record) {
      if (closed) return;
      stream.write(`${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
    },
    close() {
      closed = true;
      return new Promise((resolve) => stream.end(resolve));
    },
  };
}
