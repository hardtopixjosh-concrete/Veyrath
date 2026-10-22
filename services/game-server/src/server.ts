import { randomInt, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CLOSE_CODES,
  LIMITS,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ClientMessage,
  type ErrorCode,
  type ErrorMessage,
  type InputMessage,
  type JoinRoomMessage,
  type RejoinMessage,
} from '@veyrath/protocol';
import { DEFAULT_SIM_CONFIG, snapshotWorld } from '@veyrath/sim';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { DEFAULT_SERVER_CONFIG, type ServerConfig } from './config';
import { ClientConnection } from './connection';
import { silentLogger, type Logger } from './logger';
import { Room, generateRoomCode, type Member } from './room';
import { FixedTicker } from './ticker';

export interface ServerTotals {
  connectionsAccepted: number;
  connectionsRejected: number;
  bytesIn: number;
  bytesOut: number;
  invalidMessages: number;
  rejectedInputs: number;
  droppedInputs: number;
  rateLimitDrops: number;
  skippedSnapshots: number;
  snapshotsSent: number;
}

export interface ServerStats {
  uptimeMs: number;
  tickRate: number;
  ticks: number;
  avgTickMs: number;
  maxTickMs: number;
  behindResets: number;
  rooms: number;
  members: number;
  connectedMembers: number;
  connections: number;
  totals: ServerTotals;
}

const errorMessage = (code: ErrorCode, message: string, fatal: boolean): ErrorMessage => ({
  t: 'error',
  code,
  message,
  fatal,
});

function rawByteLength(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((n, b) => n + b.length, 0);
  return data instanceof ArrayBuffer ? data.byteLength : data.length;
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8') : data.toString('utf8');
}

function tokensEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Standalone authoritative server: owns rooms, player identity, validated input, and the fixed-tick
 * simulation. Clients only ever send intent; everything they see comes from snapshots.
 */
export class GameServer {
  readonly config: ServerConfig;
  private readonly log: Logger;
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private ticker: FixedTicker | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private readonly rooms = new Map<string, Room>();
  private readonly connections = new Set<ClientConnection>();
  private nextConnectionId = 1;
  private seedCounter = 0;
  private startedAt = 0;
  private state: 'idle' | 'running' | 'stopping' = 'idle';
  private totals: ServerTotals = GameServer.emptyTotals();

  constructor(config: Partial<ServerConfig> = {}, logger: Logger = silentLogger) {
    this.config = { ...DEFAULT_SERVER_CONFIG, ...config };
    this.log = logger;
  }

  private static emptyTotals(): ServerTotals {
    return {
      connectionsAccepted: 0,
      connectionsRejected: 0,
      bytesIn: 0,
      bytesOut: 0,
      invalidMessages: 0,
      rejectedInputs: 0,
      droppedInputs: 0,
      rateLimitDrops: 0,
      skippedSnapshots: 0,
      snapshotsSent: 0,
    };
  }

  get isRunning(): boolean {
    return this.state === 'running';
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.state !== 'idle') throw new Error(`cannot start server in state ${this.state}`);
    const http = createServer((req, res) => this.handleHttp(req, res));
    const wss = new WebSocketServer({
      server: http,
      maxPayload: LIMITS.maxClientMessageBytes,
      perMessageDeflate: false,
      clientTracking: false,
    });
    wss.on('connection', (ws) => this.handleConnection(ws));
    wss.on('error', (err) => this.log.error('websocket server error', { error: err.message }));

    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(this.config.port, this.config.host, () => {
        http.off('error', reject);
        resolve();
      });
    });
    http.on('error', (err) => this.log.error('http server error', { error: err.message }));

    this.http = http;
    this.wss = wss;
    this.totals = GameServer.emptyTotals();
    this.startedAt = Date.now();
    this.state = 'running';
    this.ticker = new FixedTicker(DEFAULT_SIM_CONFIG.tickRate, () => this.tick());
    this.ticker.start();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.config.heartbeatIntervalMs);
    this.statsTimer = setInterval(() => this.logStats(), this.config.statsIntervalMs);

    const address = http.address() as AddressInfo;
    return { host: this.config.host, port: address.port };
  }

  /** Stops ticking, closes every connection and the listener. Safe to call repeatedly. */
  async stop(): Promise<void> {
    if (this.state !== 'running') return;
    this.state = 'stopping';
    this.ticker?.stop();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.heartbeatTimer = null;
    this.statsTimer = null;

    const closing = [...this.connections];
    for (const conn of closing) {
      conn.send(errorMessage('server_shutdown', 'Server is shutting down', true));
      conn.close(1001, 'server shutdown');
    }
    const deadline = Date.now() + 1000;
    while (this.connections.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    for (const conn of this.connections) conn.terminate();
    for (const conn of closing) this.clearLobbyTimer(conn);
    this.connections.clear();
    this.rooms.clear();

    const http = this.http;
    const wss = this.wss;
    this.http = null;
    this.wss = null;
    this.ticker = null;
    await new Promise<void>((resolve) => (wss ? wss.close(() => resolve()) : resolve()));
    if (http) {
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
    this.state = 'idle';
  }

  getStats(): ServerStats {
    let members = 0;
    let connectedMembers = 0;
    for (const room of this.rooms.values()) {
      for (const m of room.members.values()) {
        members++;
        if (m.conn) connectedMembers++;
      }
    }
    const t = this.ticker?.stats;
    return {
      uptimeMs: this.state === 'running' ? Date.now() - this.startedAt : 0,
      tickRate: DEFAULT_SIM_CONFIG.tickRate,
      ticks: t?.ticks ?? 0,
      avgTickMs: t?.avgTickMs ?? 0,
      maxTickMs: t?.maxTickMs ?? 0,
      behindResets: t?.behindResets ?? 0,
      rooms: this.rooms.size,
      members,
      connectedMembers,
      connections: this.connections.size,
      totals: { ...this.totals },
    };
  }

  /** Internal counts for leak checks in tests. */
  debugCounts(): {
    rooms: number;
    connections: number;
    lobbyTimers: number;
    wssConnectionListeners: number;
    queuedInputs: number;
  } {
    let queuedInputs = 0;
    for (const room of this.rooms.values()) {
      for (const m of room.members.values()) queuedInputs += m.queue.size;
    }
    return {
      rooms: this.rooms.size,
      connections: this.connections.size,
      lobbyTimers: [...this.connections].filter((c) => c.lobbyTimer !== null).length,
      wssConnectionListeners: this.wss?.listenerCount('connection') ?? 0,
      queuedInputs,
    };
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  // ---- HTTP ------------------------------------------------------------------------------------

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, ...this.getStats() }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }

  // ---- connections -----------------------------------------------------------------------------

  private handleConnection(ws: WebSocket): void {
    if (this.state !== 'running' || this.connections.size >= this.config.maxConnections) {
      this.totals.connectionsRejected++;
      ws.close(1013, 'server busy');
      return;
    }
    const conn = new ClientConnection(this.nextConnectionId++, ws, this.config);
    this.connections.add(conn);
    this.totals.connectionsAccepted++;
    this.armLobbyTimer(conn);
    this.log.debug('connection opened', { conn: conn.id, connections: this.connections.size });

    ws.on('message', (data, isBinary) => this.handleMessage(conn, data, isBinary));
    ws.on('pong', () => {
      conn.isAlive = true;
    });
    ws.on('close', (code) => this.handleClose(conn, code));
    ws.on('error', (err) => this.log.debug('socket error', { conn: conn.id, error: err.message }));
  }

  private armLobbyTimer(conn: ClientConnection): void {
    this.clearLobbyTimer(conn);
    conn.lobbyTimer = setTimeout(() => {
      conn.lobbyTimer = null;
      if (conn.member || conn.closed) return;
      conn.send(errorMessage('handshake_timeout', 'No room joined in time', true));
      conn.close(CLOSE_CODES.handshakeTimeout, 'handshake timeout');
    }, this.config.lobbyTimeoutMs);
  }

  private clearLobbyTimer(conn: ClientConnection): void {
    if (conn.lobbyTimer) clearTimeout(conn.lobbyTimer);
    conn.lobbyTimer = null;
  }

  private handleClose(conn: ClientConnection, code: number): void {
    conn.closed = true;
    this.clearLobbyTimer(conn);
    this.connections.delete(conn);
    const ref = conn.member;
    conn.member = null;
    if (ref) {
      const room = this.rooms.get(ref.roomCode);
      const member = room?.members.get(ref.memberId);
      if (room && member && member.conn === conn) {
        room.detach(member, Date.now());
        this.log.info('player disconnected', {
          room: room.code,
          player: member.id,
          code,
          graceMs: this.config.reconnectGraceMs,
        });
      }
    }
    this.log.debug('connection closed', {
      conn: conn.id,
      code,
      connections: this.connections.size,
    });
  }

  private handleMessage(conn: ClientConnection, data: RawData, isBinary: boolean): void {
    if (conn.closed) return;
    const size = rawByteLength(data);
    conn.bytesIn += size;
    conn.messagesIn++;
    this.totals.bytesIn += size;

    if (!conn.allowMessage()) {
      this.totals.rateLimitDrops++;
      if (conn.rateLimitExceeded) {
        this.log.warn('closing connection: rate limit', { conn: conn.id });
        conn.send(errorMessage('rate_limited', 'Too many messages', true));
        conn.close(CLOSE_CODES.rateLimited, 'rate limited');
      }
      return;
    }
    if (isBinary) {
      this.rejectInvalid(conn, 'binary frames are not supported');
      return;
    }
    const parsed = parseClientMessage(rawToString(data), size);
    if (!parsed.ok) {
      this.rejectInvalid(conn, parsed.error);
      return;
    }
    this.dispatch(conn, parsed.msg);
  }

  private rejectInvalid(conn: ClientConnection, reason: string): void {
    conn.invalidMessages++;
    this.totals.invalidMessages++;
    if (conn.invalidMessages > this.config.maxInvalidMessages) {
      this.log.warn('closing connection: too many invalid messages', { conn: conn.id, reason });
      conn.send(errorMessage('bad_message', reason, true));
      conn.close(CLOSE_CODES.badMessage, 'too many invalid messages');
    } else if (conn.invalidMessages <= 3) {
      conn.send(errorMessage('bad_message', reason, false));
    }
  }

  private dispatch(conn: ClientConnection, msg: ClientMessage): void {
    switch (msg.t) {
      case 'input':
        return this.handleInput(conn, msg);
      case 'ping':
        conn.send({ t: 'pong', id: msg.id, clientTime: msg.clientTime, serverTime: Date.now() });
        return;
      case 'create':
        if (!this.checkJoinPreconditions(conn, msg.v)) return;
        if (this.rooms.size >= this.config.maxRooms) {
          conn.send(errorMessage('server_full', 'No free rooms on this server', false));
          return;
        }
        return this.createRoom(conn, msg.name);
      case 'join':
        return this.joinRoom(conn, msg);
      case 'rejoin':
        return this.rejoinRoom(conn, msg);
      case 'leave':
        return this.leaveRoom(conn);
    }
  }

  private checkJoinPreconditions(conn: ClientConnection, version: number): boolean {
    if (version !== PROTOCOL_VERSION) {
      this.log.info('protocol version mismatch', { conn: conn.id, client: version });
      conn.send(
        errorMessage(
          'version_mismatch',
          `Server speaks protocol ${PROTOCOL_VERSION}, client sent ${version}. Update the game.`,
          true,
        ),
      );
      conn.close(CLOSE_CODES.versionMismatch, 'protocol version mismatch');
      return false;
    }
    if (conn.member) {
      conn.send(errorMessage('already_in_room', 'Leave the current room first', false));
      return false;
    }
    return true;
  }

  private nextSeed(): number {
    if (this.config.seed !== undefined) return (this.config.seed + this.seedCounter++) >>> 0;
    return randomInt(0x7fffffff);
  }

  private createRoom(conn: ClientConnection, name: string): void {
    const room = new Room(
      generateRoomCode((code) => this.rooms.has(code)),
      this.nextSeed(),
      this.config.inputQueueSize,
    );
    this.rooms.set(room.code, room);
    this.log.info('room created', { room: room.code, rooms: this.rooms.size });
    this.admit(conn, room, room.addMember(name));
  }

  private joinRoom(conn: ClientConnection, msg: JoinRoomMessage): void {
    if (!this.checkJoinPreconditions(conn, msg.v)) return;
    const room = this.rooms.get(msg.room);
    if (!room) {
      conn.send(errorMessage('room_not_found', `No room ${msg.room}`, false));
      return;
    }
    if (room.isFull) {
      conn.send(errorMessage('room_full', `Room ${msg.room} is full`, false));
      return;
    }
    this.admit(conn, room, room.addMember(msg.name));
  }

  private rejoinRoom(conn: ClientConnection, msg: RejoinMessage): void {
    if (!this.checkJoinPreconditions(conn, msg.v)) return;
    const room = this.rooms.get(msg.room);
    const member = room?.members.get(msg.playerId);
    if (!room || !member || !tokensEqual(member.token, msg.token)) {
      conn.send(errorMessage('rejoin_failed', 'That player slot is no longer held', false));
      return;
    }
    const previous = member.conn;
    if (previous && previous !== conn) {
      // A rejoin wins over a half-dead old socket (e.g. the server has not noticed the drop yet).
      previous.member = null;
      previous.send(errorMessage('replaced', 'Signed in from another connection', true));
      previous.close(CLOSE_CODES.replaced, 'replaced');
    }
    this.admit(conn, room, member, true);
  }

  private admit(conn: ClientConnection, room: Room, member: Member, rejoined = false): void {
    this.clearLobbyTimer(conn);
    room.attach(member, conn);
    conn.member = { roomCode: room.code, memberId: member.id };
    conn.send({
      t: 'welcome',
      v: PROTOCOL_VERSION,
      room: room.code,
      playerId: member.id,
      token: member.token,
      slot: member.slot,
      tickRate: DEFAULT_SIM_CONFIG.tickRate,
      snapshotRate: DEFAULT_SIM_CONFIG.tickRate / this.config.snapshotEveryTicks,
      reconnectGraceMs: this.config.reconnectGraceMs,
    });
    this.log.info(rejoined ? 'player rejoined' : 'player joined', {
      room: room.code,
      player: member.id,
      slot: member.slot,
      players: room.size,
    });
  }

  private leaveRoom(conn: ClientConnection): void {
    const ref = conn.member;
    if (!ref) return;
    conn.member = null;
    const room = this.rooms.get(ref.roomCode);
    if (room) {
      room.removeMember(ref.memberId);
      this.log.info('player left', { room: room.code, player: ref.memberId, players: room.size });
      if (room.size === 0) this.deleteRoom(room);
    }
    conn.send({ t: 'left' });
    this.armLobbyTimer(conn);
  }

  private handleInput(conn: ClientConnection, msg: InputMessage): void {
    const ref = conn.member;
    const member = ref ? this.rooms.get(ref.roomCode)?.members.get(ref.memberId) : undefined;
    if (!member || member.conn !== conn) {
      conn.rejectedInputs++;
      this.totals.rejectedInputs++;
      return;
    }
    const result = member.queue.push(msg.seq, {
      moveX: msg.moveX,
      moveY: msg.moveY,
      attack: msg.attack,
    });
    if (result === 'duplicate' || result === 'out_of_order') {
      conn.rejectedInputs++;
      this.totals.rejectedInputs++;
    } else if (result === 'accepted_dropped_oldest') {
      this.totals.droppedInputs++;
    }
  }

  // ---- simulation ------------------------------------------------------------------------------

  private tick(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      room.step();
      if (room.world.tick % this.config.snapshotEveryTicks === 0) this.broadcastSnapshot(room);
      this.expireMembers(room, now);
    }
  }

  private broadcastSnapshot(room: Room): void {
    // Serialize the world once; only the per-recipient ack differs.
    const worldJson = JSON.stringify(snapshotWorld(room.world));
    const tickMs = Math.round((this.ticker?.stats.avgTickMs ?? 0) * 1000) / 1000;
    for (const member of room.members.values()) {
      const conn = member.conn;
      if (!conn) continue;
      const before = conn.bytesOut;
      const result = conn.sendRaw(
        `{"t":"snapshot","ack":${member.lastProcessedSeq},"tickMs":${tickMs},"world":${worldJson}}`,
        true,
      );
      if (result === 'sent') {
        this.totals.snapshotsSent++;
        this.totals.bytesOut += conn.bytesOut - before;
      } else if (result === 'skipped') {
        this.totals.skippedSnapshots++;
      } else if (result === 'overflow') {
        this.log.warn('terminated slow consumer', { room: room.code, player: member.id });
      }
    }
  }

  private expireMembers(room: Room, now: number): void {
    for (const member of room.members.values()) {
      if (
        member.disconnectedAt !== null &&
        now - member.disconnectedAt >= this.config.reconnectGraceMs
      ) {
        room.removeMember(member.id);
        this.log.info('player slot released', { room: room.code, player: member.id });
      }
    }
    if (room.size === 0) this.deleteRoom(room);
  }

  private deleteRoom(room: Room): void {
    if (this.rooms.delete(room.code)) {
      this.log.info('room closed', { room: room.code, rooms: this.rooms.size });
    }
  }

  private heartbeat(): void {
    for (const conn of this.connections) {
      if (!conn.isAlive) {
        this.log.info('terminating unresponsive connection', { conn: conn.id });
        conn.terminate();
        continue;
      }
      conn.isAlive = false;
      conn.ping();
    }
  }

  private logStats(): void {
    const s = this.getStats();
    if (s.connections === 0 && s.rooms === 0) return;
    this.log.info('stats', {
      rooms: s.rooms,
      players: s.members,
      connected: s.connectedMembers,
      connections: s.connections,
      ticks: s.ticks,
      avgTickMs: s.avgTickMs.toFixed(3),
      maxTickMs: s.maxTickMs.toFixed(3),
      behindResets: s.behindResets,
      bytesIn: s.totals.bytesIn,
      bytesOut: s.totals.bytesOut,
      skippedSnapshots: s.totals.skippedSnapshots,
      rejectedInputs: s.totals.rejectedInputs,
      invalid: s.totals.invalidMessages,
      rateLimited: s.totals.rateLimitDrops,
    });
    this.ticker?.resetWindow();
  }
}
