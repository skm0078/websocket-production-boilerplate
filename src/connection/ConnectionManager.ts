/**
 * ConnectionManager: owns the lifecycle of every socket.
 *
 * Heartbeat (the zombie detector):
 *   - every heartbeatIntervalMs: if the connection missed its last pong, miss++.
 *     After maxHeartbeatMisses, terminate() it — sockets.terminate() nukes the
 *     TCP connection immediately, unlike close() which waits for a handshake a
 *     dead client can never complete.
 *   - a pong marks the connection alive again and resets the miss counter.
 *
 * Cleanup discipline: on remove, every pending ACK promise is rejected and
 * the state machine is parked in CLOSED. Socket listeners are deliberately
 * left attached: a connection removed while its socket is still open (heartbeat
 * terminate, shutdown) must still deliver the imminent close event to the
 * server's close handler and the ws server's client bookkeeping.
 */
import WebSocket from "ws";
import { metrics } from "../logging/Metrics";
import { ConnectionState, ConnectionStateMachine } from "./ConnectionState";
import { WS_CLOSE_CODES, WebSocketError } from "../errors/WebSocketError";

export interface ClientIdentity {
  userId: string;
  ip: string;
}

export interface PendingAck {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export interface ManagedConnection {
  id: string;
  socket: WebSocket;
  identity: ClientIdentity;
  state: ConnectionStateMachine;
  heartbeatMisses: number;
  alive: boolean;
  subscribedRooms: Set<string>;
  pendingAcks: Map<string, PendingAck>;
}

export interface ConnectionManagerOptions {
  heartbeatIntervalMs: number;
  maxHeartbeatMisses: number;
  onTerminate?: (connection: ManagedConnection, reason: string) => void;
  onClose?: (connection: ManagedConnection, code: number, reason: string) => void;
}

export class ConnectionManager {
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly heartbeatTimer: NodeJS.Timeout;
  private readonly opts: ConnectionManagerOptions;

  constructor(opts: ConnectionManagerOptions) {
    this.opts = opts;
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), opts.heartbeatIntervalMs);
    // Don't keep the process alive just for the heartbeat loop
    this.heartbeatTimer.unref();
  }

  add(connection: ManagedConnection): void {
    this.connections.set(connection.id, connection);
    metrics.inc("ws_connections_total");
    metrics.setGauge("ws_connections_active", this.connections.size);
  }

  remove(connectionId: string, code: number, reason: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    this.cleanup(connection);
    this.connections.delete(connectionId);
    metrics.setGauge("ws_connections_active", this.connections.size);
    this.opts.onClose?.(connection, code, reason);
  }

  get(connectionId: string): ManagedConnection | undefined {
    return this.connections.get(connectionId);
  }

  getAll(): ManagedConnection[] {
    return [...this.connections.values()];
  }

  get size(): number {
    return this.connections.size;
  }

  recordPong(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    connection.alive = true;
    connection.heartbeatMisses = 0;
  }

  private checkHeartbeats(): void {
    for (const connection of this.connections.values()) {
      if (connection.state.state !== ConnectionState.OPEN) continue;

      if (connection.alive === false) {
        connection.heartbeatMisses += 1;
        if (connection.heartbeatMisses >= this.opts.maxHeartbeatMisses) {
          this.terminate(connection, `no pong for ${connection.heartbeatMisses} consecutive intervals`);
          continue;
        }
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }

  private terminate(connection: ManagedConnection, reason: string): void {
    this.opts.onTerminate?.(connection, reason);
    try {
      connection.socket.terminate();
    } catch {
      // socket already gone — remove() below is a no-op then
    }
    this.remove(connection.id, WS_CLOSE_CODES.GOING_AWAY, reason);
  }

  private cleanup(connection: ManagedConnection): void {
    for (const [, pending] of connection.pendingAcks) {
      clearTimeout(pending.timer);
      pending.reject(new WebSocketError(WS_CLOSE_CODES.GOING_AWAY, "connection closed before ack"));
    }
    connection.pendingAcks.clear();
    if (connection.state.state !== ConnectionState.CLOSED) {
      connection.state.transition(ConnectionState.CLOSED);
    }
    // Deliberately NO socket.removeAllListeners() here: terminate() and
    // shutdown() run while the socket is still open, and the close event that
    // follows must still reach (a) the ws server's internal bookkeeping
    // (wss._clients drain -> wss close callback) and (b) the server's own
    // close handler (room cleanup, rate-limiter release). Stripping the
    // listeners used to ghost every zombie-killed connection and deadlock
    // graceful shutdown. remove() is idempotent via the connections map, so a
    // second cleanup from the close handler is a no-op.
  }

  /** Drain everything. Called during graceful shutdown. */
  shutdown(): void {
    clearInterval(this.heartbeatTimer);
    for (const connection of this.connections.values()) {
      try {
        connection.socket.close(WS_CLOSE_CODES.GOING_AWAY, "server shutting down");
      } catch {
        // ignore: socket already dead
      }
      this.cleanup(connection);
    }
    this.connections.clear();
    metrics.setGauge("ws_connections_active", 0);
  }
}
