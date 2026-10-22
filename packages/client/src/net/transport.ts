import { utf8ByteLength } from '@veyrath/protocol';

export interface TransportStats {
  bytesSent: number;
  bytesReceived: number;
  messagesSent: number;
  messagesReceived: number;
  /** Bytes queued locally but not yet handed to the network. */
  bufferedAmount: number;
}

export interface TransportHandlers {
  onOpen(): void;
  onMessage(text: string): void;
  /** Called exactly once, whether the close was local, remote, or a failed connect. */
  onClose(code: number, reason: string): void;
}

/**
 * Message transport seen by the game session. WebSockets today; anything that can carry ordered
 * text frames can implement this later without touching game code.
 */
export interface Transport {
  readonly isOpen: boolean;
  readonly stats: TransportStats;
  send(text: string): boolean;
  close(code?: number, reason?: string): void;
}

export type TransportFactory = (url: string, handlers: TransportHandlers) => Transport;

class WebSocketTransport implements Transport {
  private readonly ws: WebSocket | null = null;
  private closeReported = false;
  private counters = { bytesSent: 0, bytesReceived: 0, messagesSent: 0, messagesReceived: 0 };

  constructor(
    url: string,
    private readonly handlers: TransportHandlers,
  ) {
    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      queueMicrotask(() => this.reportClose(1006, `invalid server URL: ${String(err)}`));
      return;
    }
    const ws = this.ws;
    ws.onopen = () => handlers.onOpen();
    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      this.counters.bytesReceived += utf8ByteLength(event.data);
      this.counters.messagesReceived += 1;
      handlers.onMessage(event.data);
    };
    ws.onclose = (event: CloseEvent) => this.reportClose(event.code, event.reason);
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get stats(): TransportStats {
    return { ...this.counters, bufferedAmount: this.ws?.bufferedAmount ?? 0 };
  }

  send(text: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(text);
    this.counters.bytesSent += utf8ByteLength(text);
    this.counters.messagesSent += 1;
    return true;
  }

  close(code = 1000, reason = ''): void {
    if (!this.ws) return;
    if (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(code, reason);
    }
  }

  private reportClose(code: number, reason: string): void {
    if (this.closeReported) return;
    this.closeReported = true;
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
    }
    this.handlers.onClose(code, reason);
  }
}

export const createWebSocketTransport: TransportFactory = (url, handlers) =>
  new WebSocketTransport(url, handlers);
