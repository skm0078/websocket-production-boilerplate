/**
 * Room tests: bidirectional membership maps + the in-memory adapter contract
 * (which RedisRoomAdapter mirrors 1:1).
 */
import { RoomManager } from "../src/rooms/RoomManager";
import { InMemoryRoomAdapter } from "../src/rooms/InMemoryRoomAdapter";
import type { MessageEnvelope } from "../src/messages/types";

describe("RoomManager", () => {
  it("tracks membership in both directions", () => {
    const manager = new RoomManager();

    expect(manager.addToRoom("lobby", "conn-1")).toBe(true);
    expect(manager.addToRoom("lobby", "conn-1")).toBe(false); // idempotent
    expect(manager.addToRoom("dms", "conn-1")).toBe(true);
    expect(manager.addToRoom("lobby", "conn-2")).toBe(true);

    expect(manager.getRoomMembers("lobby")).toEqual(new Set(["conn-1", "conn-2"]));
    expect(manager.getConnectionRooms("conn-1")).toEqual(new Set(["lobby", "dms"]));
    expect(manager.getStats()).toEqual({ roomCount: 2, membershipCount: 3 });
  });

  it("removes from a single room without touching the rest", () => {
    const manager = new RoomManager();
    manager.addToRoom("lobby", "conn-1");
    manager.addToRoom("dms", "conn-1");

    expect(manager.removeFromRoom("lobby", "conn-1")).toBe(true);
    expect(manager.removeFromRoom("lobby", "conn-1")).toBe(false); // already gone

    expect(manager.getRoomMembers("lobby")).toBeUndefined();
    expect(manager.getConnectionRooms("conn-1")).toEqual(new Set(["dms"]));
  });

  it("cleans up a disconnected connection from every room", () => {
    const manager = new RoomManager();
    manager.addToRoom("lobby", "conn-1");
    manager.addToRoom("dms", "conn-1");
    manager.addToRoom("lobby", "conn-2");

    const removedRooms = manager.cleanupConnection("conn-1");

    expect(removedRooms.sort()).toEqual(["dms", "lobby"]);
    expect(manager.getRoomMembers("lobby")).toEqual(new Set(["conn-2"]));
    expect(manager.getConnectionRooms("conn-1").size).toBe(0);
    expect(manager.getStats()).toEqual({ roomCount: 1, membershipCount: 1 });
  });
});

describe("InMemoryRoomAdapter", () => {
  it("delivers published messages to room subscribers", async () => {
    const roomManager = new RoomManager();
    const adapter = new InMemoryRoomAdapter(roomManager);
    const received: Array<{ room: string; message: MessageEnvelope }> = [];
    adapter.onRoomMessage((room, message) => received.push({ room, message }));

    await adapter.subscribeToRoom("lobby", "conn-1");
    await adapter.subscribeToRoom("lobby", "conn-2");
    await adapter.subscribeToRoom("lobby", "conn-2"); // double subscribe is a no-op

    const message: MessageEnvelope = {
      id: "m1",
      type: "publish",
      room: "lobby",
      payload: { text: "hello" },
      timestamp: Date.now()
    };
    await adapter.publishToRoom("lobby", message);

    expect(received).toHaveLength(1);
    expect(received[0].room).toBe("lobby");
    expect(received[0].message.id).toBe("m1");
    expect(roomManager.getStats().membershipCount).toBe(2); // conn-2 counted once
  });

  it("delivers to members only — unsubscribe stops delivery (server-side filter)", async () => {
    const roomManager = new RoomManager();
    const adapter = new InMemoryRoomAdapter(roomManager);
    const received: MessageEnvelope[] = [];

    // The adapter is a dumb bus (same contract as RedisRoomAdapter, which cannot
    // filter cross-instance). Membership filtering is the server's deliverToRoom
    // job — emulate it here; the real path is covered end-to-end in server.test.ts.
    adapter.onRoomMessage((room, message) => {
      const members = roomManager.getRoomMembers(room);
      if (members?.has("conn-1")) {
        received.push(message);
      }
    });

    await adapter.subscribeToRoom("lobby", "conn-1");
    await adapter.unsubscribeFromRoom("lobby", "conn-1");
    await adapter.unsubscribeFromRoom("lobby", "conn-1"); // idempotent no-op

    const message: MessageEnvelope = {
      id: "m2",
      type: "publish",
      room: "lobby",
      timestamp: Date.now()
    };
    await adapter.publishToRoom("lobby", message);

    expect(received).toHaveLength(0);
  });
});
