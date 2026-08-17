/**
 * ConnectionManager tests: the heartbeat kill-path is the most dangerous code
 * in the server (it kills live connections) — covered with fake timers.
 */
import type WebSocket from "ws";
import { ConnectionManager, type ManagedConnection } from "../src/connection/ConnectionManager";
import { ConnectionState, ConnectionStateMachine } from "../src/connection/ConnectionState";
import { FakeSocket } from "./fakeSocket";

jest.useFakeTimers();

function makeConnection(): { connection: ManagedConnection; socket: FakeSocket } {
  const socket = new FakeSocket();
  const connection: ManagedConnection = {
    id: `conn-${Math.random().toString(36).slice(2, 10)}`,
    // FakeSocket is a faithful subset of ws's WebSocket for what we use
    socket: socket as unknown as WebSocket,
    identity: { userId: "user-1", ip: "127.0.0.1" },
    state: new ConnectionStateMachine(),
    heartbeatMisses: 0,
    alive: true,
    subscribedRooms: new Set(),
    pendingAcks: new Map()
  };
  connection.state.transition(ConnectionState.OPEN);
  return { connection, socket };
}

function makeManager(onTerminate?: (connection: ManagedConnection, reason: string) => void) {
  return new ConnectionManager({ heartbeatIntervalMs: 1000, maxHeartbeatMisses: 2, onTerminate });
}

describe("ConnectionManager", () => {
  it("adds and removes connections", () => {
    const manager = makeManager();
    const { connection } = makeConnection();

    manager.add(connection);
    expect(manager.size).toBe(1);
    expect(manager.get(connection.id)).toBe(connection);

    manager.remove(connection.id, 1000, "test");
    expect(manager.size).toBe(0);
    expect(manager.get(connection.id)).toBeUndefined();
  });

  it("terminates zombies after maxHeartbeatMisses", () => {
    const onTerminate = jest.fn();
    const manager = makeManager(onTerminate);
    const { connection, socket } = makeConnection();
    manager.add(connection);

    // tick 1: alive -> ping; tick 2: no pong -> miss 1; tick 3: miss 2 -> terminate
    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(1000);
    jest.advanceTimersByTime(1000);

    expect(onTerminate).toHaveBeenCalledTimes(1);
    expect(socket.terminated).toBe(true);
    expect(manager.size).toBe(0);
  });

  it("keeps connections alive while pongs arrive", () => {
    const onTerminate = jest.fn();
    const manager = makeManager(onTerminate);
    const { connection, socket } = makeConnection();
    manager.add(connection);

    // Simulate a healthy client answering every ping
    for (let tick = 0; tick < 5; tick += 1) {
      jest.advanceTimersByTime(1000);
      manager.recordPong(connection.id);
    }

    expect(onTerminate).not.toHaveBeenCalled();
    expect(socket.terminated).toBe(false);
    expect(manager.size).toBe(1);
  });

  it("resets the miss counter when a late pong arrives", () => {
    const onTerminate = jest.fn();
    const manager = makeManager(onTerminate);
    const { connection } = makeConnection();
    manager.add(connection);

    // Miss one ping, then recover with a pong before the second miss
    jest.advanceTimersByTime(1000); // ping sent, no pong
    manager.recordPong(connection.id); // late but in time
    jest.advanceTimersByTime(2000); // two more ticks

    expect(onTerminate).not.toHaveBeenCalled();
    expect(manager.size).toBe(1);
  });

  it("rejects pending acks when a connection is removed", async () => {
    const manager = makeManager();
    const { connection } = makeConnection();
    manager.add(connection);

    const ackPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {}, 5000);
      connection.pendingAcks.set("m1", { resolve, reject, timer });
    });

    manager.remove(connection.id, 1000, "closed");

    await expect(ackPromise).rejects.toThrow("connection closed before ack");
  });

  it("keeps the socket's close listener attached after remove (ghost-connection regression)", () => {
    const manager = makeManager();
    const { connection, socket } = makeConnection();
    const onClose = jest.fn(); // what ws bookkeeping + the server's close handler attach
    socket.on("close", onClose);
    manager.add(connection);

    // Removed while the socket is still open (heartbeat terminate / shutdown path)
    manager.remove(connection.id, 1000, "removed while open");
    expect(manager.size).toBe(0);

    // A real socket emits 'close' asynchronously afterwards — the listener must
    // still be attached so room cleanup, rate-limiter release, and ws client
    // bookkeeping run. Stripping it used to ghost every terminated connection.
    socket.emit("close", 1006, Buffer.from("terminated"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("drains all connections on shutdown", () => {
    const manager = makeManager();
    const { connection, socket } = makeConnection();
    manager.add(connection);

    manager.shutdown();

    expect(manager.size).toBe(0);
    expect(socket.closeCalled).toBe(true);
  });
});
