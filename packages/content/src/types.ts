/**
 * Content is split in two halves. `gameplay` is read by the server simulation (and by the client
 * for prediction); `presentation` is read by the client only. Nothing in `presentation` may affect
 * the outcome of play.
 */

export type ContentKind = 'hero' | 'enemy' | 'boss';

export interface AttackDef {
  readonly id: string;
  readonly damage: number;
  /** Extra reach beyond touching, world units. */
  readonly reach: number;
  /** Ticks between uses. */
  readonly cooldownTicks: number;
  /** Ticks between pressing attack and the hit landing (0 = instant, as in Milestone 1). */
  readonly windUpTicks: number;
}

export interface GameplayDef {
  readonly maxHp: number;
  /** World units per second. */
  readonly speed: number;
  readonly radius: number;
  readonly attacks: readonly AttackDef[];
  /** Enemy/boss only: simple behaviour parameters the server AI reads. */
  readonly ai?: {
    readonly behaviour: 'wander' | 'chase';
    readonly retargetTicks: number;
    readonly aggroRange: number;
  };
}

export type AnimationState = 'idle' | 'run' | 'attack' | 'hit' | 'die';

export interface PresentationDef {
  /** Display name. */
  readonly name: string;
  /** Until real art exists: a placeholder shape and colour. */
  readonly placeholder: {
    readonly shape: 'circle' | 'square';
    readonly color: string;
  };
  /** Path under the client's assets folder, when real art exists. */
  readonly spriteSheet?: string;
  /** A rigged 3D model (glTF binary) drawn instead of a sprite. */
  readonly model?: ModelDef;
  readonly animations?: Partial<Record<AnimationState, string>>;
  readonly sounds?: Partial<Record<'swing' | 'hit' | 'die', string>>;
}

export interface ModelDef {
  /** Path under the client's assets folder, e.g. `heroes/alchemist.glb`. */
  readonly file: string;
  /** Optional file holding weapon meshes, one root node per weapon. */
  readonly weaponsFile?: string;
  /** Weapon root node to place in the right hand. */
  readonly weapon?: string;
  /** Model height in its own units, used to scale it to the game's size. */
  readonly heightUnits: number;
  /** Animation clip names in the model. */
  readonly clips: { readonly idle: string; readonly run: string; readonly attack: string };
}

export interface ContentDef {
  readonly id: string;
  readonly kind: ContentKind;
  readonly gameplay: GameplayDef;
  readonly presentation: PresentationDef;
}

export interface ContentPack {
  readonly heroes: readonly ContentDef[];
  readonly enemies: readonly ContentDef[];
  readonly bosses: readonly ContentDef[];
}
