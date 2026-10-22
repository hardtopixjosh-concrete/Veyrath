import { describe, expect, it } from 'vitest';
import { connectionQuality } from '../../packages/client/src/quality';

const base = {
  phase: 'in_room',
  rttMs: 40,
  rttJitterMs: 5,
  snapshotsPerSec: 30,
  msSinceSnapshot: 30,
};

describe('connectionQuality', () => {
  it('rates a local-feeling connection as good, with the ping in the label', () => {
    expect(connectionQuality(base)).toEqual({ level: 'good', label: 'Good · 40 ms' });
  });

  it('downgrades on ping, jitter or a low update rate', () => {
    expect(connectionQuality({ ...base, rttMs: 140 }).level).toBe('fair');
    expect(connectionQuality({ ...base, rttJitterMs: 30 }).level).toBe('fair');
    expect(connectionQuality({ ...base, snapshotsPerSec: 24 }).level).toBe('fair');
    expect(connectionQuality({ ...base, rttMs: 260 }).level).toBe('poor');
    expect(connectionQuality({ ...base, rttJitterMs: 80 }).level).toBe('poor');
    expect(connectionQuality({ ...base, snapshotsPerSec: 12 }).level).toBe('poor');
  });

  it('flags stalls, reconnects and being offline', () => {
    expect(connectionQuality({ ...base, msSinceSnapshot: 1500 })).toEqual({
      level: 'lost',
      label: 'No updates',
    });
    expect(connectionQuality({ ...base, phase: 'reconnecting' }).label).toBe('Reconnecting…');
    expect(connectionQuality({ ...base, phase: 'idle' }).level).toBe('lost');
  });

  it('shows a dash before the first ping arrives', () => {
    expect(connectionQuality({ ...base, rttMs: null, rttJitterMs: null }).label).toBe('Good · –');
  });
});
