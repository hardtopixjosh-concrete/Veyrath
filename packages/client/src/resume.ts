import { isValidRoomCode } from '@veyrath/protocol';

/**
 * The "come back as the same player" ticket, kept on disk so it survives closing the game. The
 * server holds a dropped player's slot for `graceMs`; if the game is reopened within that time it
 * rejoins with this ticket instead of joining as a new player (which left a ghost of the old one
 * for up to 15 s in the first friend test).
 */
export interface ResumeTicket {
  url: string;
  room: string;
  playerId: string;
  token: string;
  graceMs: number;
  /** Wall-clock ms when this client last knew it was connected. */
  lastSeenAt: number;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Leave this much margin so we don't race the server releasing the slot. */
const SAFETY_MARGIN_MS = 1500;

export class ResumeStore {
  constructor(
    private readonly store: KeyValueStore | null,
    private readonly key: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  save(ticket: Omit<ResumeTicket, 'lastSeenAt'>): void {
    this.write({ ...ticket, lastSeenAt: this.now() });
  }

  /** Marks the ticket as still connected right now. */
  touch(): void {
    const t = this.read();
    if (t) this.write({ ...t, lastSeenAt: this.now() });
  }

  clear(): void {
    try {
      this.store?.removeItem(this.key);
    } catch {
      // storage unavailable: nothing to clear
    }
  }

  /** The saved ticket if the server can still be holding the slot, otherwise null (and cleared). */
  loadUsable(): ResumeTicket | null {
    const t = this.read();
    if (!t) return null;
    const age = this.now() - t.lastSeenAt;
    if (age < 0 || age > t.graceMs - SAFETY_MARGIN_MS) {
      this.clear();
      return null;
    }
    return t;
  }

  private read(): ResumeTicket | null {
    let raw: string | null;
    try {
      raw = this.store?.getItem(this.key) ?? null;
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const t = JSON.parse(raw) as Partial<ResumeTicket>;
      const ok =
        typeof t.url === 'string' &&
        /^wss?:\/\//.test(t.url) &&
        isValidRoomCode(t.room) &&
        typeof t.playerId === 'string' &&
        typeof t.token === 'string' &&
        typeof t.graceMs === 'number' &&
        typeof t.lastSeenAt === 'number';
      return ok ? (t as ResumeTicket) : null;
    } catch {
      return null;
    }
  }

  private write(t: ResumeTicket): void {
    try {
      this.store?.setItem(this.key, JSON.stringify(t));
    } catch {
      // A convenience only: without storage, a restart simply joins as a new player.
    }
  }
}

export function browserStorage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
