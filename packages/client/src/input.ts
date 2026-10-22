import { IDLE_INPUT, type PlayerInput } from '@veyrath/sim';
import type { InputSource } from './net/session';

const MOVE_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
const ATTACK_KEYS = new Set(['Space', 'KeyJ']);

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/** Keyboard state sampled once per input tick. Cleared on blur so keys never stick. */
export class KeyboardInput implements InputSource {
  enabled = false;
  private readonly held = new Set<string>();
  /** Remembers a tap that started and ended between two samples. */
  private attackTapped = false;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (!this.enabled || isTypingTarget(e.target)) return;
      if (MOVE_KEYS.has(e.code) || ATTACK_KEYS.has(e.code)) {
        e.preventDefault();
        this.held.add(e.code);
        if (ATTACK_KEYS.has(e.code)) this.attackTapped = true;
      }
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
  }

  sample(): PlayerInput {
    if (!this.enabled) return IDLE_INPUT;
    const h = this.held;
    const x =
      Number(h.has('KeyD') || h.has('ArrowRight')) - Number(h.has('KeyA') || h.has('ArrowLeft'));
    const y =
      Number(h.has('KeyS') || h.has('ArrowDown')) - Number(h.has('KeyW') || h.has('ArrowUp'));
    const attack = this.attackTapped || [...ATTACK_KEYS].some((k) => h.has(k));
    this.attackTapped = false;
    return { moveX: x, moveY: y, attack };
  }
}
