import { randomBytes, randomInt } from 'node:crypto';
import { LIMITS, ROOM_CODE_ALPHABET } from '@veyrath/protocol';
import {
  addPlayer,
  createWorld,
  getPlayer,
  removePlayer,
  stepWorld,
  type PlayerInput,
  type StepResult,
  type World,
} from '@veyrath/sim';
import type { ClientConnection } from './connection';
import { InputQueue } from './inputQueue';

export interface Member {
  readonly id: string;
  readonly token: string;
  readonly name: string;
  readonly slot: number;
  readonly queue: InputQueue;
  conn: ClientConnection | null;
  /** Last input seq applied by the simulation (sent back as `ack`). */
  lastProcessedSeq: number;
  /** Wall-clock ms when the connection dropped; null while connected. */
  disconnectedAt: number | null;
}

export function generateRoomCode(isTaken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < LIMITS.roomCodeLength; i++) {
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    }
    if (!isTaken(code)) return code;
  }
  throw new Error('could not allocate a unique room code');
}

/** One authoritative world plus the players attached to it. */
export class Room {
  readonly world: World;
  readonly members = new Map<string, Member>();

  constructor(
    readonly code: string,
    seed: number,
    private readonly inputQueueSize: number,
  ) {
    this.world = createWorld(seed);
  }

  get size(): number {
    return this.members.size;
  }

  get isFull(): boolean {
    return this.members.size >= Math.min(LIMITS.maxPlayersPerRoom, this.world.config.maxPlayers);
  }

  addMember(name: string): Member {
    if (this.isFull) throw new Error('room is full');
    const used = new Set([...this.members.values()].map((m) => m.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    let id: string;
    do id = `p_${randomBytes(4).toString('hex')}`;
    while (this.members.has(id));
    const member: Member = {
      id,
      token: randomBytes(16).toString('hex'),
      name,
      slot,
      queue: new InputQueue(this.inputQueueSize),
      conn: null,
      lastProcessedSeq: -1,
      disconnectedAt: null,
    };
    addPlayer(this.world, id, name, slot);
    this.members.set(id, member);
    return member;
  }

  removeMember(id: string): void {
    const member = this.members.get(id);
    if (!member) return;
    member.conn = null;
    member.queue.clear();
    this.members.delete(id);
    removePlayer(this.world, id);
  }

  attach(member: Member, conn: ClientConnection): void {
    member.conn = conn;
    member.disconnectedAt = null;
    member.queue.clear();
    const player = getPlayer(this.world, member.id);
    if (player) player.connected = true;
  }

  detach(member: Member, now: number): void {
    member.conn = null;
    member.disconnectedAt = now;
    member.queue.clear();
    const player = getPlayer(this.world, member.id);
    if (player) player.connected = false;
  }

  /** Advances one fixed tick, consuming at most one queued input per connected member. */
  step(): StepResult {
    const inputs = new Map<string, PlayerInput>();
    for (const member of this.members.values()) {
      if (!member.conn) continue;
      const next = member.queue.shift();
      if (!next) continue;
      inputs.set(member.id, next.input);
      member.lastProcessedSeq = next.seq;
    }
    return stepWorld(this.world, inputs);
  }
}
