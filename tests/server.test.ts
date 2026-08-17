/**
 * End-to-end server tests: real ws clients against ProductionWebSocketServer
 * on an ephemeral port. Covers the handshake walls, the message pipeline, and
 * the room delivery semantics that unit tests cannot (membership filtering
 * lives in deliverToRoom).
 */
import http from "http";
import WebSocket from "ws";
import type { AddressInfo } from "net";
import { LogLevel, StructuredLogger } from "../src/logging/Logger";
import { Auth } from "../src/security/Auth";
import { OriginValidator } from "../src/security/OriginValidator";
import { RoomManager } from "../src/rooms/RoomManager";
import { InMemoryRoomAdapter } from "../src/rooms/InMemoryRoomAdapter";
import { ConnectionManager } from "../src/connection/ConnectionManager";
import { ConnectionRateLimiter } from "../src/rate-limit/ConnectionRateLimiter";
import { MessageRateLimiter } from "../src/rate-limit/MessageRateLimiter";
import { MessageRouter } from "../src/messages/Router";
import { ProductionWebSocketServer } from "../src/server/WebSocketServer";
import type { MessageEnvelope } from "../src/messages/types";

const ALLOWED_ORIGIN = "http://localhost:3000";
const ORIGIN = { origin: ALLOWED_ORIGIN };

interface ServerContext {
  baseUrl: string;
  token: string;
  httpServer: http.Server;
  wss: ProductionWebSocketServer;
  connectionManager: ConnectionManager;
  roomManager: RoomManager;
}

interface TestServerOverrides {
  heartbeatIntervalMs?: number;
  maxHeartbeatMisses?: number;
  maxConnectionsPerIp?: number;
  maxConnectionsPerUser?: number;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition not met in time");
    await delay(10);
  }
}

async function startTestServer(overrides: TestServerOverrides = {}): Promise<ServerContext> {
  const auth = new Auth("test-secret");
  const roomManager = new RoomManager();
  const roomAdapter = new InMemoryRoomAdapter(roomManager);
  const connectionManager = new ConnectionManager({
    heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? 25000,
    maxHeartbeatMisses: overrides.maxHeartbeatMisses ?? 2
  });

  const httpServer = http.createServer();
  const wss = new ProductionWebSocketServer({
    httpServer,
    auth,
    originValidator: new OriginValidator([ALLOWED_ORIGIN]),
    roomAdapter,
    roomManager,
    connectionManager,
    messageRouter: new MessageRouter({
      roomAdapter,
      maxMessageSizeBytes: 1024 * 1024,
      ackTimeoutMs: 5000,
      sanitizePayload: (raw) => raw
    }),
    connectionRateLimiter: new ConnectionRateLimiter(
      overrides.maxConnectionsPerIp ?? 20,
      overrides.maxConnectionsPerUser ?? 5
    ),
    messageRateLimiter: new MessageRateLimiter(30),
    maxMessageSizeBytes: 1024 * 1024,
    logger: new StructuredLogger({ minLevel: LogLevel.ERROR })
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;

  return {
    baseUrl: `ws://127.0.0.1:${address.port}`,
    token: auth.sign({ sub: "user-1" }),
    httpServer,
    wss,
    connectionManager,
    roomManager
  };
}

async function stopTestServer(ctx: ServerContext): Promise<void> {
  ctx.connectionManager.shutdown(); // closes managed sockets + clears the heartbeat interval
  ctx.wss.close(); // stop accepting upgrades (external http server: do NOT wait for its callback)

  // Force-close the HTTP server. With an external server, wss.close(cb) never
  // fires its callback, and httpServer.close(cb) waits on lingering sockets —
  // so destroy every connection and only then await the callback.
  await new Promise<void>((resolve) => {
    const httpServer = ctx.httpServer;
    httpServer.close(() => resolve());
    if (typeof httpServer.closeAllConnections === "function") {
      httpServer.closeAllConnections();
    }
  });
}

function openSocket(ctx: ServerContext): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${ctx.baseUrl}?token=${ctx.token}`, ORIGIN);
    socket.on("open", () => resolve(socket));
    socket.on("error", reject);
  });
}

function waitForAck(socket: WebSocket, messageId: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`timed out waiting for ack of ${messageId}`));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData): void => {
      const frame = JSON.parse(data.toString()) as MessageEnvelope;
      const payload = frame.payload as { messageId?: string } | undefined;
      if (frame.type === "ack" && payload?.messageId === messageId) {
        clearTimeout(timer);
        socket.off("message", onMessage);
        resolve();
      }
    };
    socket.on("message", onMessage);
  });
}

function send(socket: WebSocket, message: MessageEnvelope): void {
  socket.send(JSON.stringify(message));
}

describe("ProductionWebSocketServer", () => {
  let server: ServerContext;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await stopTestServer(server);
  });

  it("rejects handshakes without an allowed Origin with 4001", async () => {
    const socket = new WebSocket(`${server.baseUrl}?token=${server.token}`);
    socket.on("error", () => {
      // expected: server closes the handshake
    });

    const closeCode = await new Promise<number>((resolve) => {
      socket.on("close", (code) => resolve(code));
    });

    expect(closeCode).toBe(4001);
  });

  it("rejects publish before subscribe with an error frame and close 4004", async () => {
    const socket = await openSocket(server);
    const frames: MessageEnvelope[] = [];
    socket.on("message", (data) => frames.push(JSON.parse(data.toString()) as MessageEnvelope));

    const closeCode = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
    send(socket, {
      id: "m0",
      type: "publish",
      room: "lobby",
      payload: { bid: 1 },
      timestamp: Date.now(),
      requiresAck: true
    });

    expect(await closeCode).toBe(4004);
    const errorFrame = frames.find((f) => f.type === "error");
    expect((errorFrame?.payload as { code?: number } | undefined)?.code).toBe(4004);
  });

  it("stops delivering to a client that left the room — end to end", async () => {
    const clientA = await openSocket(server);
    const clientB = await openSocket(server);
    const framesA: MessageEnvelope[] = [];
    const framesB: MessageEnvelope[] = [];
    clientA.on("message", (data) => framesA.push(JSON.parse(data.toString()) as MessageEnvelope));
    clientB.on("message", (data) => framesB.push(JSON.parse(data.toString()) as MessageEnvelope));

    // Both clients join the room
    send(clientA, {
      id: "s1",
      type: "subscribe",
      room: "lobby",
      timestamp: Date.now(),
      requiresAck: true
    });
    await waitForAck(clientA, "s1");
    send(clientB, {
      id: "s2",
      type: "subscribe",
      room: "lobby",
      timestamp: Date.now(),
      requiresAck: true
    });
    await waitForAck(clientB, "s2");

    // A receives broadcasts while subscribed
    send(clientB, {
      id: "p1",
      type: "publish",
      room: "lobby",
      payload: { bid: 250 },
      timestamp: Date.now(),
      requiresAck: true
    });
    await waitForAck(clientB, "p1");
    expect(framesA.some((f) => f.id === "p1")).toBe(true);

    // A leaves; B publishes again — A must not receive it
    send(clientA, {
      id: "u1",
      type: "unsubscribe",
      room: "lobby",
      timestamp: Date.now(),
      requiresAck: true
    });
    await waitForAck(clientA, "u1");
    framesA.length = 0;

    send(clientB, {
      id: "p2",
      type: "publish",
      room: "lobby",
      payload: { bid: 500 },
      timestamp: Date.now(),
      requiresAck: true
    });
    await waitForAck(clientB, "p2");
    expect(framesB.some((f) => f.id === "p2")).toBe(true);

    // Any stray frame for A would already be buffered by now (ws is ordered):
    // the ack to B is sent after deliverToRoom ran
    await delay(50);
    expect(framesA.some((f) => f.id === "p2")).toBe(false);

    clientA.close();
    clientB.close();
  });

  it("drains without ghosts on shutdown: rooms cleaned, slots released, no deadlock", async () => {
    // Per-user cap of 1: a leaked slot would block the reconnect below.
    const ctx = await startTestServer({ maxConnectionsPerUser: 1 });
    const client = await openSocket(ctx);

    send(client, {
      id: "s1",
      type: "subscribe",
      room: "lobby",
      timestamp: Date.now(),
      requiresAck: true
    });
    await waitForAck(client, "s1");
    const connectionId = ctx.connectionManager.getAll()[0].id;
    expect(ctx.roomManager.getRoomMembers("lobby")?.has(connectionId)).toBe(true);

    // Drain: closes the managed socket while it is still open — the same
    // cleanup() the heartbeat-terminate path uses. The close event fires
    // asynchronously and must still reach the server's close handler.
    ctx.connectionManager.shutdown();
    await waitFor(() => ctx.roomManager.getRoomMembers("lobby") === undefined);
    expect(ctx.connectionManager.size).toBe(0);

    // The per-user slot was released: the same user can connect again.
    // Before the ghost-connection fix this failed with 4006.
    const clientB = await openSocket(ctx);
    expect(clientB.readyState).toBe(WebSocket.OPEN);
    clientB.close();

    await stopTestServer(ctx);
  });
});