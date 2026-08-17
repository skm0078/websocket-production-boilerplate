/**
 * ConnectionRateLimiter: caps how many simultaneous sockets one IP / one user
 * may hold. The first wall a flood hits — 10k sockets from one compromised
 * client should die at the door, not after allocating memory.
 *
 * State is per-instance memory. (See LEARNINGS.md doubt #5: a Redis-backed
 * version is the next step for multi-instance deployments.)
 */

export class ConnectionRateLimiter {
  private readonly ipCounts = new Map<string, number>();
  private readonly userCounts = new Map<string, number>();

  constructor(
    private readonly maxConnectionsPerIp: number,
    private readonly maxConnectionsPerUser: number
  ) {}

  tryAcquire(ip: string, userId: string): boolean {
    const ipCount = this.ipCounts.get(ip) ?? 0;
    const userCount = this.userCounts.get(userId) ?? 0;
    if (ipCount >= this.maxConnectionsPerIp || userCount >= this.maxConnectionsPerUser) {
      return false;
    }
    this.ipCounts.set(ip, ipCount + 1);
    this.userCounts.set(userId, userCount + 1);
    return true;
  }

  release(ip: string, userId: string): void {
    this.decrement(this.ipCounts, ip);
    this.decrement(this.userCounts, userId);
  }

  private decrement(map: Map<string, number>, key: string): void {
    const count = map.get(key) ?? 0;
    if (count <= 1) {
      map.delete(key); // zero entries stay out of the map — no unbounded growth
    } else {
      map.set(key, count - 1);
    }
  }
}
