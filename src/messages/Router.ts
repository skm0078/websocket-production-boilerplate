/**
 * MessageRouter: the single choke point for every inbound frame.
 *
 * Pipeline (in order, cheapest first):
 *   1. size limit       — reject giants before parsing
 *   2. JSON parse       — malformed JSON is a protocol error
 *   3. zod envelope     — shape guarantee for everything downstream
 *   4. payload sanitize — app-specific schema (optional)
 *   5. route            — ack resolves pending server requests, others hit handlers
 *
 * Also owns the server -> client request-response pattern (pendingAcks).
 */
import WebSocket from "ws";
import type { ManagedConnection } from "../connection/ConnectionManager";
import type { RoomAdapter } from "../rooms/RoomAdapter";
import type { StructuredLogger } from "../logging/Logger";
import { logger as defaultLogger } from "../logging/Logger";
import { metrics } from "../logging/Metrics";
import { WS_CLOSE_CODES, WebSocketError } from "../errors/WebSocketError";
import type { MessageEnvelope, MessageType } from "./types";
import { messageEnvelopeSchema } from "./types";
import {
  type MessageHandler,
  type MessageHandlerDeps,
  publishHandler,
  subscribeHandler,
  unsubscribeHandler,
  heartbeatHandler
} from "./handlers";

export interface MessageRouterOptions {
  roomAdapter: RoomAdapter;
  maxMessageSizeBytes: number;
  ackTimeoutMs: number;
  logger?: StructuredLogger;
  /** Optional app-specific payload validator (a zod schema's .parse). */
  sanitizePayload?: (raw: unknown) => unknown;
}

export class MessageRouter {
  private readonly opts: MessageRouterOptions;
  private readonly logger: StructuredLogger;
  private readonly handlers: Partial<Record<MessageType, MessageHandler>> = {
    publish: publishHandler,
    subscribe: subscribeHandler,
    unsubscribe: unsubscribeHandler,
    heartbeat: heartbeatHandler
  };

  constructor(opts: MessageRouterOptions) {
    this.opts = opts;
    this.logger = opts.logger ?? defaultLogger;
  }

  private get deps(): MessageHandlerDeps {
    return {
      roomAdapter: this.opts.roomAdapter,
      logger: this.logger,
      send: (connection, message) => this.send(connection, message)
    };
  }

  async dispatch(connection: ManagedConnection, raw: WebSocket.RawData): Promise<void> {
    const startedAt = Date.now();
    metrics.inc("ws_messages_received_total");

    // 1. Normalize raw data (single Buffer, array of fragments, or ArrayBuffer)
    let payload: Buffer;
    if (Buffer.isBuffer(raw)) {
      payload = raw;
    } else if (Array.isArray(raw)) {
      payload = Buffer.concat(raw);
    } else {
      payload = Buffer.from(raw);
    }

    // 2. Reject giants BEFORE parsing — cheap and saves the CPU
    if (payload.byteLength > this.opts.maxMessageSizeBytes) {
      throw new WebSocketError(WS_CLOSE_CODES.MESSAGE_TOO_LARGE, "message exceeds size limit");
    }

    // 3. JSON parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.toString("utf8"));
    } catch {
      throw new WebSocketError(WS_CLOSE_CODES.INVALID_MESSAGE, "malformed JSON");
    }

    // 4. Schema-validate the envelope
    const result = messageEnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path.join(".") ?? "unknown";
      throw new WebSocketError(
        WS_CLOSE_CODES.INVALID_MESSAGE,
        `envelope invalid at ${path}: ${issue?.message ?? "unknown"}`
      );
    }
    const message = result.data as MessageEnvelope;

    // 5. App-level payload validation (plug in your own schema)
    if (message.payload !== undefined && this.opts.sanitizePayload) {
      try {
        message.payload = this.opts.sanitizePayload(message.payload);
      } catch {
        throw new WebSocketError(WS_CLOSE_CODES.INVALID_MESSAGE, "payload failed validation");
      }
    }

    // 6. Client -> server acks resolve pending server requests
    if (message.type === "ack") {
      this.resolveClientAck(connection, message);
      return;
    }

    // 7. Route to the handler
    const handler = this.handlers[message.type];
    if (!handler) {
      throw new WebSocketError(
        WS_CLOSE_CODES.INVALID_MESSAGE,
        `unsupported message type: ${message.type}`
      );
    }
    await handler(this.deps, connection, message);

    metrics.observe("ws_message_processing_duration", Date.now() - startedAt);
  }

  send(connection: ManagedConnection, message: MessageEnvelope): void {
    if (connection.socket.readyState !== WebSocket.OPEN) {
      metrics.inc("ws_messages_dropped_total");
      return;
    }
    connection.socket.send(JSON.stringify(message));
    metrics.inc("ws_messages_sent_total");
  }

  /**
   * Server -> client request-response: the returned promise resolves when the
   * client acks the message id, or rejects on timeout / connection close.
   */
  requestResponse(
    connection: ManagedConnection,
    message: MessageEnvelope,
    timeoutMs: number = this.opts.ackTimeoutMs
  ): Promise<unknown> {
    if (connection.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new WebSocketError(WS_CLOSE_CODES.GOING_AWAY, "connection not open")
      );
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pendingAcks.delete(message.id);
        reject(new Error(`ack timeout for message ${message.id} after ${timeoutMs}ms`));
      }, timeoutMs);
      connection.pendingAcks.set(message.id, { resolve, reject, timer });
      this.send(connection, message);
    });
  }

  resolveAck(connection: ManagedConnection, messageId: string, value: unknown): void {
    const pending = connection.pendingAcks.get(messageId);
    if (!pending) return;
    clearTimeout(pending.timer);
    connection.pendingAcks.delete(messageId);
    pending.resolve(value);
  }

  rejectAck(connection: ManagedConnection, messageId: string, error: Error): void {
    const pending = connection.pendingAcks.get(messageId);
    if (!pending) return;
    clearTimeout(pending.timer);
    connection.pendingAcks.delete(messageId);
    pending.reject(error);
  }

  private resolveClientAck(connection: ManagedConnection, message: MessageEnvelope): void {
    const payload = message.payload as { messageId?: unknown } | undefined;
    if (typeof payload?.messageId !== "string") return; // malformed ack: ignore, never crash
    this.resolveAck(connection, payload.messageId, message.payload);
  }
}
