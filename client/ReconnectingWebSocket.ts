/**
 * ReconnectingWebSocket: the browser client that survives reality.
 *
 * What reality does to a naive WebSocket:
 *   - networks blip (elevators, tunnels, NAT timeouts)      -> reconnect
 *   - the server restarts mid-deploy                        -> reconnect
 *   - a thousand clients reconnect at once                  -> thundering herd
 *   - messages arrive while we are offline                  -> lost
 *
 * This client answers with:
 *   - a state machine (connecting / connected / reconnecting / disconnected)
 *   - exponential backoff 1s -> 30s (x2) with +-15% jitter  -> no herd
 *   - an outgoing queue (cap 1000) flushed on reconnect     -> no lost messages
 *   - application heartbeats (25s) with heartbeat_ack       -> dead-link detection
 *
 * Drop-in for the native WebSocket API: same constructor-ish usage,
 * `send()`, and message events — but `new ReconnectingWebSocket(url)`.
 */

export type ReconnectState = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface ReconnectingWebSocketOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  multiplier?: number;
  /** +-jitterRatio applied to every delay to desynchronize reconnecting clients. */
  jitterRatio?: number;
  maxQueueSize?: number;
  heartbeatIntervalMs?: number;
  protocols?: string | string[];
}

type ResolvedOptions = Required<Omit<ReconnectingWebSocketOptions, "protocols">> & {
  protocols?: string | string[];
};

export class ReconnectingWebSocket {
  private socket: WebSocket | null = null;
  private state: ReconnectState = "disconnected";
  private reconnectAttempts = 0;
  private queue: unknown[] = [];
  private droppedCount = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;

  private readonly url: string;
  private readonly opts: ResolvedOptions;

  // User callbacks (same names as native WebSocket, minus one: use onreconnect/onstatechange)
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onreconnect: ((attempt: number, delayMs: number) => void) | null = null;
  onstatechange: ((state: ReconnectState) => void) | null = null;

  constructor(url: string, options: ReconnectingWebSocketOptions = {}) {
    this.url = url;
    this.opts = {
      minDelayMs: 1_000,
      maxDelayMs: 30_000,
      multiplier: 2,
      jitterRatio: 0.15,
      maxQueueSize: 1_000,
      heartbeatIntervalMs: 25_000,
      protocols: undefined,
      ...options
    };
  }

  connect(): void {
    this.shouldReconnect = true;
    this.openSocket();
  }

  /** Close for good: no reconnect, flush nothing. */
  close(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.cancelReconnectTimer(); // a pending backoff must not resurrect the socket
    this.socket?.close();
    this.socket = null;
    this.setState("disconnected");
  }

  /**
   * Send an envelope. Returns true when handed to the live socket, false when
   * queued (or dropped). Messages are dropped, never blocked: a queue past its
   * cap is a memory bomb, and a stale message is worth less than the client.
   */
  send(data: unknown): boolean {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
      return true;
    }
    if (this.queue.length >= this.opts.maxQueueSize) {
      this.queue.shift(); // drop oldest, keep the freshest slot
      this.droppedCount += 1;
    }
    this.queue.push(data);
    return false;
  }

  getState(): ReconnectState {
    return this.state;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }

  private openSocket(): void {
    if (!this.shouldReconnect) return; // closed between scheduling and firing
    this.setState(this.reconnectAttempts === 0 ? "connecting" : "reconnecting");
    this.socket = new WebSocket(this.url, this.opts.protocols);

    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.flushQueue();
      this.startHeartbeat();
    };

    this.socket.onmessage = (event) => this.onmessage?.(event);

    this.socket.onerror = () => this.onerror?.();

    this.socket.onclose = (event) => {
      this.stopHeartbeat();
      this.socket = null;

      if (!this.shouldReconnect) {
        this.setState("disconnected");
        this.onclose?.(event);
        return;
      }

      const delay = this.nextDelay();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.openSocket();
      }, delay);
      this.onreconnect?.(this.reconnectAttempts, delay);
    };
  }

  /** minDelay * multiplier^(attempt-1), capped at maxDelay, +- jitter. */
  private nextDelay(): number {
    this.reconnectAttempts += 1;
    const base = Math.min(
      this.opts.maxDelayMs,
      this.opts.minDelayMs * Math.pow(this.opts.multiplier, this.reconnectAttempts - 1)
    );
    const jitter = base * this.opts.jitterRatio * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  private flushQueue(): void {
    while (this.queue.length > 0 && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(this.queue.shift()));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(
          JSON.stringify({
            id: `hb-${Date.now()}`,
            type: "heartbeat",
            timestamp: Date.now(),
            requiresAck: true
          })
        );
      }
    }, this.opts.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private cancelReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(state: ReconnectState): void {
    this.state = state;
    this.onstatechange?.(state);
  }
}
