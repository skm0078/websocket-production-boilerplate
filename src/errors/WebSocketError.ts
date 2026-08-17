/**
 * Error taxonomy for the WebSocket protocol.
 *
 * 1000-2999: standard close codes (defined by the WebSocket spec / ws library).
 * 4000-4999: application-specific — a documented contract the client switches on.
 */

export const WS_CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  AUTH_FAILED: 4001,
  RATE_LIMITED: 4002,
  MESSAGE_TOO_LARGE: 4003,
  INVALID_MESSAGE: 4004,
  CONNECTION_LIMIT: 4006
} as const;

export type WSCloseCode = (typeof WS_CLOSE_CODES)[keyof typeof WS_CLOSE_CODES];

export class WebSocketError extends Error {
  constructor(
    public readonly code: WSCloseCode,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "WebSocketError";
  }
}
