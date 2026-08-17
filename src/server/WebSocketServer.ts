/**
 * ProductionWebSocketServer: the handshake-to-grave lifecycle of every socket.
 *
 * Connection pipeline (cheapest checks first, each returns before work begins):
 *   1. Origin  — CSWSH wall
 *   2. Auth    — JWT, userId comes out of it
 *   3. Limits  — per-IP / per-user connection caps
 *   4. Track   — state machine, heartbeat, room membership, pending acks
 *
 * Inbound messages go through MessageRouter; room fan-out comes back through
 * onRoomMessage (from Redis or the in-memory adapter).
 */
import http from "http";
import { randomUUID } from "crypto";
import WebSocket, { WebSocketServer as WsServer } from "ws";
import type { ConnectionManager, ManagedConnection } from "../connection/ConnectionManager";
import { ConnectionState, ConnectionStateMachine } from "../connection/ConnectionState";
import type { MessageRouter } from "../messages/Router";
import type { MessageEnvelope } from "../messages/types";
import type { RoomAdapter } from "../rooms/RoomAdapter";
import type { RoomManager } from "../rooms/RoomManager";
import type { ConnectionRateLimiter } from "../rate-limit/ConnectionRateLimiter";
import type { MessageRateLimiter } from "../rate-limit/MessageRateLimiter";
import type { Auth } from "../security/Auth";
import type { OriginValidator } from "../security/OriginValidator";
import type { StructuredLogger } from "../logging/Logger";
import { metrics } from "../logging/Metrics";
import { WS_CLOSE_CODES, WebSocketError } from "../errors/WebSocketError";

export interface ProductionWebSocketServerOptions {
  httpServer: http.Server;
  auth: Auth;
  originValidator: OriginValidator;
  roomAdapter: RoomAdapter;
  roomManager: RoomManager;
  connectionManager: ConnectionManager;
  messageRouter: MessageRouter;
  connectionRateLimiter: ConnectionRateLimiter;
  messageRateLimiter: MessageRateLimiter;
  maxMessageSizeBytes: number;
  logger: StructuredLogger;
}

export class ProductionWebSocketServer {
  private readonly wss: WsServer;

  constructor(private readonly opts: ProductionWebSocketServerOptions) {
    this.wss = new WsServer({
      server: opts.httpServer,
      maxPayload: opts.maxMessageSizeBytes
    });

    this.wss.on("connection", (socket, request) => this.handleConnection(socket, request));
    this.opts.roomAdapter.onRoomMessage((room, message) => this.deliverToRoom(room, message));
  }

  private handleConnection(socket: WebSocket, request: http.IncomingMessage): void {
    const ip = request.socket.remoteAddress ?? "unknown";

    // 1. Origin wall — cheapest rejection, before auth even runs
    if (!this.opts.originValidator.validate(request.headers.origin)) {
      socket.close(WS_CLOSE_CODES.AUTH_FAILED, "origin not allowed");
      return;
    }

    // 2. Auth — the userId everything downstream keys on
    let userId: string;
    try {
      userId = this.opts.auth.verify(this.extractToken(request.url ?? "")).sub;
    } catch (err) {
      const code = err instanceof WebSocketError ? err.code : WS_CLOSE_CODES.AUTH_FAILED;
      socket.close(code, "authentication failed");
      return;
    }

    // 3. Connection caps
    if (!this.opts.connectionRateLimiter.tryAcquire(ip, userId)) {
      socket.close(WS_CLOSE_CODES.CONNECTION_LIMIT, "connection limit reached");
      return;
    }

    // 4. Track it
    const connection: ManagedConnection = {
      id: randomUUID(),
      socket,
      identity: { userId, ip },
      state: new ConnectionStateMachine(),
      heartbeatMisses: 0,
      alive: true,
      subscribedRooms: new Set(),
      pendingAcks: new Map()
    };
    connection.state.transition(ConnectionState.OPEN);
    this.opts.connectionManager.add(connection);

    socket.on("pong", () => this.opts.connectionManager.recordPong(connection.id));
    socket.on("message", (data) => void this.handleMessage(connection, data));
    socket.on("close", (code, reason) => this.handleClose(connection, code, reason));
    socket.on("error", (err) => {
      this.opts.logger.error("socket_error", { connectionId: connection.id, error: err.message });
    });
  }

  private async handleMessage(connection: ManagedConnection, data: WebSocket.RawData): Promise<void> {
    // Per-connection message rate limit — first gate, before parsing
    if (!this.opts.messageRateLimiter.allow(connection.id)) {
      this.sendErrorAndClose(
        connection,
        new WebSocketError(WS_CLOSE_CODES.RATE_LIMITED, "message rate limit exceeded")
      );
      return;
    }

    try {
      await this.opts.messageRouter.dispatch(connection, data);
    } catch (err) {
      const wsError =
        err instanceof WebSocketError
          ? err
          : new WebSocketError(WS_CLOSE_CODES.INVALID_MESSAGE, "internal error");
      this.sendErrorAndClose(connection, wsError);
    }
  }

  private sendErrorAndClose(connection: ManagedConnection, err: WebSocketError): void {
    metrics.inc("ws_errors_total");
    this.opts.messageRouter.send(connection, {
      id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "error",
      payload: { code: err.code, message: err.message },
      timestamp: Date.now()
    });
    if (err.code >= 4000) {
      // App-level codes are fatal: the client switches on them to decide retry/re-auth/UI
      connection.socket.close(err.code, err.message.slice(0, 100));
    }
  }

  private handleClose(connection: ManagedConnection, code: number, reason: Buffer): void {
    this.opts.messageRateLimiter.reset(connection.id);

    // Leave every room — Redis channels are ref-counted, so only the last
    // local member actually tears the channel down.
    const removedRooms = this.opts.roomManager.cleanupConnection(connection.id);
    for (const room of removedRooms) {
      void this.opts.roomAdapter.unsubscribeFromRoom(room, connection.id);
    }

    this.opts.connectionRateLimiter.release(connection.identity.ip, connection.identity.userId);
    this.opts.connectionManager.remove(connection.id, code, reason.toString());
  }

  private deliverToRoom(room: string, message: MessageEnvelope): void {
    const members = this.opts.roomManager.getRoomMembers(room);
    if (!members) return;
    for (const connectionId of members) {
      const connection = this.opts.connectionManager.get(connectionId);
      if (connection) {
        this.opts.messageRouter.send(connection, message);
      }
    }
  }

  private extractToken(url: string): string {
    const queryIndex = url.indexOf("?");
    if (queryIndex === -1) return "";
    const params = new URLSearchParams(url.slice(queryIndex + 1));
    return params.get("token") ?? "";
  }

  /**
   * Stop accepting new handshakes and drain live sockets. Called during
   * graceful shutdown.
   *
   * Drain FIRST: with an external HTTP server, wss.close() merely waits for
   * clients to close themselves — nothing would ever tell them to leave.
   * Draining closes every managed socket (code 1001), which triggers the
   * close handlers (room cleanup, rate-limiter release), which lets
   * wss.close() observe the last client going away and fire its callback.
   */
  close(callback?: () => void): void {
    this.opts.connectionManager.shutdown();
    this.wss.close(callback);
  }
}
