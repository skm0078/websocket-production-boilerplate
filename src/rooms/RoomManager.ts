/**
 * RoomManager: the local source of truth for room membership.
 *
 * Bidirectional maps (room -> connections, connection -> rooms) so both
 * "who is in this room?" and "what is this connection subscribed to?"
 * are O(1) lookups. cleanupConnection() is the single exit path on disconnect.
 */

export class RoomManager {
  private readonly rooms = new Map<string, Set<string>>();
  private readonly connectionRooms = new Map<string, Set<string>>();

  /** @returns true if the membership changed (i.e. not already a member). */
  addToRoom(room: string, connectionId: string): boolean {
    const members = this.rooms.get(room) ?? new Set<string>();
    if (members.has(connectionId)) return false;
    members.add(connectionId);
    this.rooms.set(room, members);

    const connRooms = this.connectionRooms.get(connectionId) ?? new Set<string>();
    connRooms.add(room);
    this.connectionRooms.set(connectionId, connRooms);
    return true;
  }

  /** @returns true if the membership changed (i.e. the connection was a member). */
  removeFromRoom(room: string, connectionId: string): boolean {
    const members = this.rooms.get(room);
    if (!members?.has(connectionId)) return false;
    members.delete(connectionId);
    if (members.size === 0) this.rooms.delete(room);
    this.connectionRooms.get(connectionId)?.delete(room);
    return true;
  }

  /** Remove a connection from every room. @returns the rooms it was removed from. */
  cleanupConnection(connectionId: string): string[] {
    const rooms = this.connectionRooms.get(connectionId);
    this.connectionRooms.delete(connectionId);

    const removed: string[] = [];
    for (const room of rooms ?? []) {
      const members = this.rooms.get(room);
      if (members?.delete(connectionId) === true) {
        removed.push(room);
        if (members.size === 0) this.rooms.delete(room);
      }
    }
    return removed;
  }

  getRoomMembers(room: string): ReadonlySet<string> | undefined {
    return this.rooms.get(room);
  }

  getConnectionRooms(connectionId: string): ReadonlySet<string> {
    return this.connectionRooms.get(connectionId) ?? new Set<string>();
  }

  getStats(): { roomCount: number; membershipCount: number } {
    let membershipCount = 0;
    for (const members of this.rooms.values()) membershipCount += members.size;
    return { roomCount: this.rooms.size, membershipCount };
  }
}
