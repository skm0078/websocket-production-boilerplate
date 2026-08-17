/**
 * Auth: JWT verification on the WS handshake. The decoded `sub` becomes the
 * userId that identities, rate limits, and logs are keyed on.
 *
 * Why a query param? The browser WebSocket API cannot set headers, so the
 * token rides in `?token=` — the pragmatic standard. Caveat: it can leak into
 * access logs; rotate tokens and log URLs carefully. (See LEARNINGS.md #2.)
 */
import jwt from "jsonwebtoken";
import { WS_CLOSE_CODES, WebSocketError } from "../errors/WebSocketError";

export interface TokenPayload {
  sub: string;
  [key: string]: unknown;
}

export class Auth {
  constructor(private readonly secret: string) {}

  verify(raw: unknown): TokenPayload {
    if (typeof raw !== "string" || raw.length === 0) {
      throw new WebSocketError(WS_CLOSE_CODES.AUTH_FAILED, "missing auth token");
    }
    try {
      const decoded = jwt.verify(raw, this.secret) as TokenPayload;
      if (typeof decoded.sub !== "string" || decoded.sub.length === 0) {
        throw new WebSocketError(WS_CLOSE_CODES.AUTH_FAILED, "token missing subject");
      }
      return decoded;
    } catch (err) {
      if (err instanceof WebSocketError) throw err;
      throw new WebSocketError(WS_CLOSE_CODES.AUTH_FAILED, "invalid token");
    }
  }

  /** Convenience for tests and the gen-token script. */
  sign(payload: TokenPayload, expiresIn: jwt.SignOptions["expiresIn"] = "1h"): string {
    return jwt.sign(payload, this.secret, { expiresIn });
  }
}
