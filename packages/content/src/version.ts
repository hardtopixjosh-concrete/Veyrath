import type { ContentPack } from './types';

/** FNV-1a 32-bit over a string; no platform APIs so this runs identically on server and client. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Serializes with sorted keys so field order in content files cannot change the version. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Content version: a short hash of the **gameplay** halves only. Client and server compare it on
 * join, so mismatched rules are refused while a purely visual change (new sprite) does not force
 * everyone to update.
 */
export function contentVersion(pack: ContentPack): string {
  const gameplayOnly = [...pack.heroes, ...pack.enemies, ...pack.bosses].map((d) => ({
    id: d.id,
    kind: d.kind,
    gameplay: d.gameplay,
  }));
  return fnv1a(canonical(gameplayOnly)).toString(16).padStart(8, '0');
}
