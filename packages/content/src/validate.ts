import type { AttackDef, ContentDef, ContentKind, ContentPack } from './types';

export type ValidationResult = { ok: true; def: ContentDef } | { ok: false; errors: string[] };

const ID_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const PATH_PATTERN = /^[a-z0-9_\-/]+\.(png|json|glb|ogg|mp3)$/i;
const KINDS = new Set<ContentKind>(['hero', 'enemy', 'boss']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, min: number, max: number, integer = false): boolean {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= min &&
    v <= max &&
    (!integer || Number.isInteger(v))
  );
}

function checkAttack(a: unknown, where: string, errors: string[]): void {
  if (!isRecord(a)) {
    errors.push(`${where}: attack must be an object`);
    return;
  }
  if (typeof a.id !== 'string' || !ID_PATTERN.test(a.id)) errors.push(`${where}.id is invalid`);
  if (!num(a.damage, 0, 10_000)) errors.push(`${where}.damage must be 0..10000`);
  if (!num(a.reach, 0, 2_000)) errors.push(`${where}.reach must be 0..2000`);
  if (!num(a.cooldownTicks, 1, 3_000, true)) errors.push(`${where}.cooldownTicks must be 1..3000`);
  if (!num(a.windUpTicks, 0, 300, true)) errors.push(`${where}.windUpTicks must be 0..300`);
}

/**
 * Validates one content definition from untrusted JSON. Returns a rebuilt object containing only
 * known fields, so stray data in a content file never reaches game code.
 */
export function validateContent(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['content must be an object'] };

  const id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : null;
  if (!id) errors.push('id must be 2-32 chars: a-z, 0-9, _ or -');
  const kind = KINDS.has(raw.kind as ContentKind) ? (raw.kind as ContentKind) : null;
  if (!kind) errors.push('kind must be hero, enemy or boss');

  const g = raw.gameplay;
  if (!isRecord(g)) {
    errors.push('gameplay must be an object');
  } else {
    if (!num(g.maxHp, 1, 1_000_000, true)) errors.push('gameplay.maxHp must be 1..1000000');
    if (!num(g.speed, 0, 5_000)) errors.push('gameplay.speed must be 0..5000');
    if (!num(g.radius, 1, 500)) errors.push('gameplay.radius must be 1..500');
    if (!Array.isArray(g.attacks)) {
      errors.push('gameplay.attacks must be an array');
    } else {
      g.attacks.forEach((a, i) => checkAttack(a, `gameplay.attacks[${i}]`, errors));
      const ids = g.attacks.map((a) => (isRecord(a) ? a.id : undefined));
      if (new Set(ids).size !== ids.length) errors.push('gameplay.attacks ids must be unique');
    }
    if (g.ai !== undefined) {
      if (!isRecord(g.ai)) errors.push('gameplay.ai must be an object');
      else {
        if (g.ai.behaviour !== 'wander' && g.ai.behaviour !== 'chase') {
          errors.push('gameplay.ai.behaviour must be wander or chase');
        }
        if (!num(g.ai.retargetTicks, 1, 3_000, true))
          errors.push('gameplay.ai.retargetTicks invalid');
        if (!num(g.ai.aggroRange, 0, 5_000)) errors.push('gameplay.ai.aggroRange invalid');
      }
      if (kind === 'hero') errors.push('heroes must not have gameplay.ai');
    } else if (kind === 'enemy' || kind === 'boss') {
      errors.push(`${kind} needs gameplay.ai`);
    }
  }

  const p = raw.presentation;
  if (!isRecord(p)) {
    errors.push('presentation must be an object');
  } else {
    if (typeof p.name !== 'string' || p.name.trim().length === 0 || p.name.length > 32) {
      errors.push('presentation.name must be 1-32 chars');
    }
    const ph = p.placeholder;
    if (!isRecord(ph) || (ph.shape !== 'circle' && ph.shape !== 'square')) {
      errors.push('presentation.placeholder.shape must be circle or square');
    }
    if (!isRecord(ph) || typeof ph.color !== 'string' || !COLOR_PATTERN.test(ph.color)) {
      errors.push('presentation.placeholder.color must be #rrggbb');
    }
    for (const key of ['spriteSheet'] as const) {
      if (p[key] !== undefined && (typeof p[key] !== 'string' || !PATH_PATTERN.test(p[key]))) {
        errors.push(`presentation.${key} must be a relative asset path`);
      }
    }
    for (const key of ['animations', 'sounds'] as const) {
      const map = p[key];
      if (map === undefined) continue;
      if (!isRecord(map)) errors.push(`presentation.${key} must be an object`);
      else {
        for (const [k, v] of Object.entries(map)) {
          if (typeof v !== 'string' || v.length === 0 || v.length > 128) {
            errors.push(`presentation.${key}.${k} must be a non-empty string`);
          }
        }
      }
    }
  }

  if (errors.length > 0 || !id || !kind || !isRecord(g) || !isRecord(p)) {
    return { ok: false, errors };
  }

  const ph = p.placeholder as { shape: 'circle' | 'square'; color: string };
  const attacks: AttackDef[] = (g.attacks as Record<string, unknown>[]).map((a) => ({
    id: a.id as string,
    damage: a.damage as number,
    reach: a.reach as number,
    cooldownTicks: a.cooldownTicks as number,
    windUpTicks: a.windUpTicks as number,
  }));
  const ai = g.ai as Record<string, unknown> | undefined;
  const def: ContentDef = {
    id,
    kind,
    gameplay: {
      maxHp: g.maxHp as number,
      speed: g.speed as number,
      radius: g.radius as number,
      attacks,
      ...(ai
        ? {
            ai: {
              behaviour: ai.behaviour as 'wander' | 'chase',
              retargetTicks: ai.retargetTicks as number,
              aggroRange: ai.aggroRange as number,
            },
          }
        : {}),
    },
    presentation: {
      name: (p.name as string).trim(),
      placeholder: { shape: ph.shape, color: ph.color.toLowerCase() },
      ...(p.spriteSheet !== undefined ? { spriteSheet: p.spriteSheet as string } : {}),
      ...(p.animations !== undefined
        ? { animations: { ...(p.animations as Record<string, string>) } }
        : {}),
      ...(p.sounds !== undefined ? { sounds: { ...(p.sounds as Record<string, string>) } } : {}),
    },
  };
  return { ok: true, def };
}

export type PackResult = { ok: true; pack: ContentPack } | { ok: false; errors: string[] };

/** Validates a whole set of raw definitions and checks ids are unique across all kinds. */
export function buildContentPack(raws: readonly unknown[]): PackResult {
  const errors: string[] = [];
  const defs: ContentDef[] = [];
  raws.forEach((raw, i) => {
    const r = validateContent(raw);
    if (r.ok) defs.push(r.def);
    else {
      const label = isRecord(raw) && typeof raw.id === 'string' ? raw.id : `#${i}`;
      errors.push(...r.errors.map((e) => `${label}: ${e}`));
    }
  });
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.id)) errors.push(`duplicate content id: ${d.id}`);
    seen.add(d.id);
  }
  if (errors.length > 0) return { ok: false, errors };
  const byKind = (kind: ContentKind) =>
    defs.filter((d) => d.kind === kind).sort((a, b) => a.id.localeCompare(b.id));
  return {
    ok: true,
    pack: { heroes: byKind('hero'), enemies: byKind('enemy'), bosses: byKind('boss') },
  };
}
