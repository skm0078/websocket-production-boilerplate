/**
 * Rate limiter tests: the two walls that keep a flood from becoming an outage.
 */
import { ConnectionRateLimiter } from "../src/rate-limit/ConnectionRateLimiter";
import { MessageRateLimiter } from "../src/rate-limit/MessageRateLimiter";

describe("ConnectionRateLimiter", () => {
  it("caps connections per IP", () => {
    const limiter = new ConnectionRateLimiter(2, 10);

    expect(limiter.tryAcquire("1.2.3.4", "u1")).toBe(true);
    expect(limiter.tryAcquire("1.2.3.4", "u2")).toBe(true);
    expect(limiter.tryAcquire("1.2.3.4", "u3")).toBe(false); // third socket from same IP
  });

  it("caps connections per user across IPs", () => {
    const limiter = new ConnectionRateLimiter(10, 2);

    expect(limiter.tryAcquire("1.1.1.1", "alice")).toBe(true);
    expect(limiter.tryAcquire("2.2.2.2", "alice")).toBe(true);
    expect(limiter.tryAcquire("3.3.3.3", "alice")).toBe(false); // alice has 2 already
  });

  it("frees capacity on release", () => {
    const limiter = new ConnectionRateLimiter(1, 10);

    expect(limiter.tryAcquire("1.2.3.4", "u1")).toBe(true);
    expect(limiter.tryAcquire("1.2.3.4", "u2")).toBe(false);

    limiter.release("1.2.3.4", "u1");
    expect(limiter.tryAcquire("1.2.3.4", "u2")).toBe(true);
  });

  it("does not grow state forever: zero entries leave the maps", () => {
    const limiter = new ConnectionRateLimiter(1, 1);
    limiter.tryAcquire("9.9.9.9", "u1");
    limiter.release("9.9.9.9", "u1");

    // Internal maps are private; the observable contract is that a fresh
    // acquire after a full release succeeds (and stats would stay flat).
    expect(limiter.tryAcquire("9.9.9.9", "u1")).toBe(true);
  });
});

describe("MessageRateLimiter", () => {
  it("allows up to the cap per second, then blocks", () => {
    const limiter = new MessageRateLimiter(3);

    expect(limiter.allow("conn-1")).toBe(true);
    expect(limiter.allow("conn-1")).toBe(true);
    expect(limiter.allow("conn-1")).toBe(true);
    expect(limiter.allow("conn-1")).toBe(false);
    expect(limiter.allow("conn-1")).toBe(false);
  });

  it("tracks connections independently", () => {
    const limiter = new MessageRateLimiter(2);

    expect(limiter.allow("conn-a")).toBe(true);
    expect(limiter.allow("conn-b")).toBe(true);
    expect(limiter.allow("conn-b")).toBe(true);
    expect(limiter.allow("conn-a")).toBe(true);
    expect(limiter.allow("conn-a")).toBe(false); // conn-a exhausted, conn-b not
  });

  it("lets the window slide after a second", () => {
    jest.useFakeTimers();
    const limiter = new MessageRateLimiter(2);

    expect(limiter.allow("conn-1")).toBe(true);
    expect(limiter.allow("conn-1")).toBe(true);
    expect(limiter.allow("conn-1")).toBe(false);

    jest.advanceTimersByTime(1100);
    expect(limiter.allow("conn-1")).toBe(true);
    jest.useRealTimers();
  });

  it("resets on disconnect", () => {
    const limiter = new MessageRateLimiter(1);
    limiter.allow("conn-1");
    expect(limiter.allow("conn-1")).toBe(false);

    limiter.reset("conn-1");
    expect(limiter.allow("conn-1")).toBe(true);
  });
});
