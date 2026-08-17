/**
 * MessageRateLimiter: sliding 1-second window of inbound messages per
 * connection. Protects the CPU and downstream systems from a fast client loop
 * (e.g. a buggy browser tab publishing 500 msgs/sec).
 *
 * Old timestamps are pruned on access, so stale entries never accumulate.
 */

export class MessageRateLimiter {
  private readonly timestamps = new Map<string, number[]>();

  constructor(private readonly maxMessagesPerSecond: number) {}

  allow(connectionId: string): boolean {
    const now = Date.now();
    const windowStart = now - 1000;
    const recent = (this.timestamps.get(connectionId) ?? []).filter((t) => t >= windowStart);

    if (recent.length >= this.maxMessagesPerSecond) {
      this.timestamps.set(connectionId, recent);
      return false;
    }

    recent.push(now);
    this.timestamps.set(connectionId, recent);
    return true;
  }

  reset(connectionId: string): void {
    this.timestamps.delete(connectionId);
  }
}
