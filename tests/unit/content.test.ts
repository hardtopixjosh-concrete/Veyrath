import { buildContentPack, contentVersion, validateContent } from '@veyrath/content';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contentDir = resolve(__dirname, '../../content');

function loadAllContentFiles(): unknown[] {
  const raws: unknown[] = [];
  for (const kind of ['heroes', 'enemies', 'bosses']) {
    for (const file of readdirSync(resolve(contentDir, kind))) {
      if (file.endsWith('.json')) {
        raws.push(JSON.parse(readFileSync(resolve(contentDir, kind, file), 'utf8')));
      }
    }
  }
  return raws;
}

const hero = {
  id: 'knight',
  kind: 'hero',
  gameplay: {
    maxHp: 120,
    speed: 200,
    radius: 16,
    attacks: [{ id: 'slash', damage: 12, reach: 40, cooldownTicks: 10, windUpTicks: 3 }],
  },
  presentation: { name: 'Knight', placeholder: { shape: 'circle', color: '#AABBCC' } },
};

describe('validateContent', () => {
  it('accepts a well-formed hero and normalizes it', () => {
    const r = validateContent(hero);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.def.presentation.placeholder.color).toBe('#aabbcc');
  });

  it('drops unknown fields so stray data never reaches game code', () => {
    const r = validateContent({ ...hero, cheat: true, gameplay: { ...hero.gameplay, godMode: 1 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('cheat' in r.def).toBe(false);
      expect('godMode' in r.def.gameplay).toBe(false);
    }
  });

  it.each([
    ['bad id', { ...hero, id: 'Knight!' }],
    ['bad kind', { ...hero, kind: 'npc' }],
    ['hp zero', { ...hero, gameplay: { ...hero.gameplay, maxHp: 0 } }],
    ['hp fractional', { ...hero, gameplay: { ...hero.gameplay, maxHp: 10.5 } }],
    ['speed NaN', { ...hero, gameplay: { ...hero.gameplay, speed: NaN } }],
    [
      'attack cooldown 0',
      {
        ...hero,
        gameplay: {
          ...hero.gameplay,
          attacks: [{ ...hero.gameplay.attacks[0], cooldownTicks: 0 }],
        },
      },
    ],
    [
      'duplicate attack ids',
      {
        ...hero,
        gameplay: {
          ...hero.gameplay,
          attacks: [hero.gameplay.attacks[0], hero.gameplay.attacks[0]],
        },
      },
    ],
    [
      'hero with ai',
      {
        ...hero,
        gameplay: {
          ...hero.gameplay,
          ai: { behaviour: 'chase', retargetTicks: 10, aggroRange: 100 },
        },
      },
    ],
    ['enemy without ai', { ...hero, kind: 'enemy' }],
    [
      'bad colour',
      {
        ...hero,
        presentation: { ...hero.presentation, placeholder: { shape: 'circle', color: 'red' } },
      },
    ],
    [
      'absolute sprite path',
      { ...hero, presentation: { ...hero.presentation, spriteSheet: 'C:/art/knight.png' } },
    ],
    ['not an object', 'knight'],
  ])('rejects %s', (_label, raw) => {
    const r = validateContent(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('content pack', () => {
  it('every shipped content file is valid and ids are unique', () => {
    const r = buildContentPack(loadAllContentFiles());
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.pack.heroes.map((h) => h.id)).toEqual(['alchemist', 'placeholder-hero']);
      expect(r.pack.enemies.map((e) => e.id)).toEqual(['placeholder-enemy']);
      expect(r.pack.bosses.map((b) => b.id)).toEqual(['placeholder-boss']);
    }
  });

  it('rejects duplicate ids across kinds, naming the file', () => {
    const r = buildContentPack([
      hero,
      {
        ...hero,
        kind: 'enemy',
        gameplay: {
          ...hero.gameplay,
          ai: { behaviour: 'wander', retargetTicks: 10, aggroRange: 0 },
        },
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('duplicate content id: knight');
  });

  it('placeholder data matches the Milestone 1 hard-coded rules', () => {
    const r = buildContentPack(loadAllContentFiles());
    if (!r.ok) throw new Error(r.errors.join('\n'));
    const h = r.pack.heroes.find((x) => x.id === 'placeholder-hero')!;
    const e = r.pack.enemies[0]!;
    expect(h.gameplay).toMatchObject({ speed: 220, radius: 16 });
    expect(h.gameplay.attacks[0]).toMatchObject({ damage: 10, reach: 40, cooldownTicks: 12 });
    expect(e.gameplay).toMatchObject({ maxHp: 100, speed: 60, radius: 24 });
  });
});

describe('contentVersion', () => {
  const pack = () => {
    const r = buildContentPack(loadAllContentFiles());
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.pack;
  };

  it('is stable and 8 hex chars', () => {
    const v = contentVersion(pack());
    expect(v).toMatch(/^[0-9a-f]{8}$/);
    expect(contentVersion(pack())).toBe(v);
  });

  it('changes when gameplay numbers change, but not when only presentation changes', () => {
    const base = pack();
    const v = contentVersion(base);
    const gameplayChanged = {
      ...base,
      heroes: [
        { ...base.heroes[0]!, gameplay: { ...base.heroes[0]!.gameplay, speed: 221 } },
        ...base.heroes.slice(1),
      ],
    };
    const lookChanged = {
      ...base,
      heroes: [
        { ...base.heroes[0]!, presentation: { ...base.heroes[0]!.presentation, name: 'Shiny' } },
        ...base.heroes.slice(1),
      ],
    };
    expect(contentVersion(gameplayChanged)).not.toBe(v);
    expect(contentVersion(lookChanged)).toBe(v);
  });

  it('ignores key order', () => {
    const base = pack();
    const reordered = {
      ...base,
      heroes: [
        { ...base.heroes[0]!, gameplay: { ...base.heroes[0]!.gameplay } },
        ...base.heroes.slice(1),
      ],
    };
    const g = reordered.heroes[0]!.gameplay as unknown as Record<string, unknown>;
    const swapped = Object.fromEntries(Object.entries(g).reverse());
    reordered.heroes[0] = {
      ...reordered.heroes[0]!,
      gameplay: swapped as typeof g & (typeof base.heroes)[0]['gameplay'],
    };
    expect(contentVersion(reordered)).toBe(contentVersion(base));
  });
});

describe('3D model definitions', () => {
  const withModel = (model: unknown) => ({
    ...hero,
    presentation: { ...hero.presentation, model },
  });
  const good = {
    file: 'heroes/alchemist.glb',
    weaponsFile: 'heroes/weapons-ranger.glb',
    weapon: 'potion',
    heightUnits: 1.81,
    clips: { idle: 'Idle', run: 'Run', attack: 'R_potion' },
  };

  it('accepts a model and keeps only known fields', () => {
    const r = validateContent(withModel({ ...good, extra: 1 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.def.presentation.model).toEqual(good);
  });

  it.each([
    ['non-glb file', { ...good, file: 'heroes/alchemist.png' }],
    ['absolute path', { ...good, file: 'C:/x/alchemist.glb' }],
    ['bad height', { ...good, heightUnits: 0 }],
    ['missing clip', { ...good, clips: { idle: 'Idle', run: 'Run' } }],
    ['bad weapon name', { ...good, weapon: '../potion' }],
  ])('rejects %s', (_label, model) => {
    expect(validateContent(withModel(model)).ok).toBe(false);
  });

  it('the shipped Alchemist file points at files that exist and plays the same rules as before', () => {
    const r = buildContentPack(loadAllContentFiles());
    if (!r.ok) throw new Error(r.errors.join('; '));
    const a = r.pack.heroes.find((x) => x.id === 'alchemist')!;
    const model = a.presentation.model!;
    for (const f of [model.file, model.weaponsFile!]) {
      expect(existsSync(resolve(__dirname, '../../packages/client/public/assets', f))).toBe(true);
    }
    expect(a.gameplay).toMatchObject({ speed: 220, radius: 16 });
  });

  it('a visual-only change (new model) does not change the content version', () => {
    const r = buildContentPack(loadAllContentFiles());
    if (!r.ok) throw new Error(r.errors.join('; '));
    const v = contentVersion(r.pack);
    const heroes = r.pack.heroes.map((x) =>
      x.id === 'alchemist'
        ? {
            ...x,
            presentation: {
              ...x.presentation,
              model: { ...x.presentation.model!, weapon: 'bombbag' },
            },
          }
        : x,
    );
    expect(contentVersion({ ...r.pack, heroes })).toBe(v);
  });
});
