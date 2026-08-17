/**
 * The wire protocol: every frame is a MessageEnvelope validated by zod.
 *
 * Why an envelope instead of bare {type, payload}?
 *   - id: correlates acks, dedupes retries, enables debugging
 *   - timestamp: freshness, latency measurements
 *   - requiresAck: turns fire-and-forget into request-response when needed
 */
import { z } from "zod";

export const MESSAGE_TYPES = [
  "publish",
  "subscribe",
  "unsubscribe",
  "ack",
  "error",
  "heartbeat",
  "heartbeat_ack"
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface MessageEnvelope {
  id: string;
  type: MessageType;
  room?: string;
  to?: string;
  payload?: unknown;
  timestamp: number;
  requiresAck?: boolean;
}

export const messageEnvelopeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(MESSAGE_TYPES),
  room: z.string().min(1).max(128).optional(),
  to: z.string().min(1).max(128).optional(),
  payload: z.unknown().optional(),
  timestamp: z.number().int().positive(),
  requiresAck: z.boolean().optional()
});

export interface AckPayload {
  messageId: string;
  status: "ok" | "error";
  error?: string;
}

export function ackMessage(messageId: string, error?: string): MessageEnvelope {
  const payload: AckPayload = error
    ? { messageId, status: "error", error }
    : { messageId, status: "ok" };
  return {
    id: `ack-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    type: "ack",
    payload,
    timestamp: Date.now()
  };
}

export function heartbeatAckMessage(inReplyTo: string): MessageEnvelope {
  return {
    id: `heartbeat_ack-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    type: "heartbeat_ack",
    payload: { inReplyTo },
    timestamp: Date.now()
  };
}
