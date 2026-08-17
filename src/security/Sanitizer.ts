/**
 * Sanitizer: app-level payload validation via zod.
 *
 * The envelope schema guarantees the shape of the frame; this guards the
 * *contents* of payloads. Plug in your own zod schema (chat messages, bids,
 * presence updates…) — anything that doesn't parse is rejected as
 * INVALID_MESSAGE before it reaches a handler.
 */
import { z } from "zod";

export class Sanitizer {
  constructor(private readonly schema: z.ZodType<unknown>) {}

  sanitize(raw: unknown): unknown {
    return this.schema.parse(raw);
  }

  /** Trivial default: any JSON value is acceptable (only envelope rules apply). */
  static passthrough(): Sanitizer {
    return new Sanitizer(z.unknown());
  }
}
