export type QualityLevel = 'good' | 'fair' | 'poor' | 'lost';

export interface QualityInput {
  phase: string;
  rttMs: number | null;
  rttJitterMs: number | null;
  snapshotsPerSec: number;
  /** Time since the last snapshot arrived, or null if none yet. */
  msSinceSnapshot: number | null;
}

export interface Quality {
  level: QualityLevel;
  label: string;
}

/**
 * Plain-language connection rating for the HUD. Thresholds are for a co-op action game at 30 Hz:
 * good feels local, fair is playable with noticeable delay, poor will rubber-band or stutter.
 */
export function connectionQuality(q: QualityInput): Quality {
  if (q.phase === 'reconnecting') return { level: 'lost', label: 'Reconnecting…' };
  if (q.phase !== 'in_room') return { level: 'lost', label: 'Offline' };
  if (q.msSinceSnapshot !== null && q.msSinceSnapshot > 1000) {
    return { level: 'lost', label: 'No updates' };
  }
  const rtt = q.rttMs ?? 0;
  const jitter = q.rttJitterMs ?? 0;
  const ping = q.rttMs === null ? '–' : `${Math.round(rtt)} ms`;
  if (rtt > 200 || jitter > 50 || q.snapshotsPerSec < 20) {
    return { level: 'poor', label: `Poor · ${ping}` };
  }
  if (rtt > 100 || jitter > 20 || q.snapshotsPerSec < 27) {
    return { level: 'fair', label: `Fair · ${ping}` };
  }
  return { level: 'good', label: `Good · ${ping}` };
}
