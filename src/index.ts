/**
 * Bootstrap: config -> services -> HTTP+WS server -> graceful shutdown.
 *
 * Shutdown contract (SIGTERM is how orchestrators talk):
 *   1. stop accepting new connections
 *   2. drain sockets (ConnectionManager.shutdown)
 *   3. close Redis clients
 *   4. exit 0 — or force-exit after 10s if something hangs
 */
import express from "express";
import http from "http";
import { loadConfig } from "./config";
import { LogLevel, StructuredLogger } from "./logging/Logger";
import { ConnectionManager } from "./connection/ConnectionManager";
import { MessageRouter } from "./messages/Router";
import { RoomManager } from "./rooms/RoomManager";
import { RedisRoomAdapter } from "./rooms/RedisRoomAdapter";
import { ConnectionRateLimiter } from "./rate-limit/ConnectionRateLimiter";
import { MessageRateLimiter } from "./rate-limit/MessageRateLimiter";
import { Auth } from "./security/Auth";
import { OriginValidator } from "./security/OriginValidator";
import { Sanitizer } from "./security/Sanitizer";
import { ProductionWebSocketServer } from "./server/WebSocketServer";
import { createHttpRouter } from "./server/prometheus";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new StructuredLogger({
    minLevel: config.logLevel as LogLevel,
    service: "websocket-server"
  });

  // Services
  const sanitizer = Sanitizer.passthrough();
  const auth = new Auth(config.jwtSecret);
  const originValidator = new OriginValidator([config.clientOrigin]);
  const roomManager = new RoomManager();
  const roomAdapter = new RedisRoomAdapter(roomManager, config.redisUrl, logger);
  const connectionManager = new ConnectionManager({
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    maxHeartbeatMisses: config.maxHeartbeatMisses,
    onTerminate: (connection, reason) =>
      logger.warn("connection_terminated", { connectionId: connection.id, reason }),
    onClose: (connection, code, reason) =>
      logger.info("connection_closed", { connectionId: connection.id, code, reason })
  });
  const messageRouter = new MessageRouter({
    roomAdapter,
    maxMessageSizeBytes: config.maxMessageSizeBytes,
    ackTimeoutMs: config.ackTimeoutMs,
    logger,
    sanitizePayload: (raw) => sanitizer.sanitize(raw)
  });
  const connectionRateLimiter = new ConnectionRateLimiter(
    config.maxConnectionsPerIp,
    config.maxConnectionsPerUser
  );
  const messageRateLimiter = new MessageRateLimiter(config.maxMessagesPerSecond);

  // HTTP + WS on one server
  const app = express();
  app.use(createHttpRouter({ metricsEnabled: config.metricsEnabled }));
  const httpServer = http.createServer(app);
  const wsServer = new ProductionWebSocketServer({
    httpServer,
    auth,
    originValidator,
    roomAdapter,
    roomManager,
    connectionManager,
    messageRouter,
    connectionRateLimiter,
    messageRateLimiter,
    maxMessageSizeBytes: config.maxMessageSizeBytes,
    logger
  });

  await roomAdapter.connect();
  httpServer.listen(config.port, config.host, () => {
    logger.info("server_started", { host: config.host, port: config.port });
  });

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutdown_started", { signal });

    const forceExit = setTimeout(() => {
      logger.error("shutdown_forced", { reason: "10s timeout" });
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    wsServer.close(() => {
      connectionManager.shutdown();
      void roomAdapter
        .disconnect()
        .then(() => process.exit(0))
        .catch((err) => {
          logger.error("shutdown_redis_error", { error: err.message });
          process.exit(1);
        });
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: Error) => {
  process.stderr.write(`FATAL: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
// staleness probe
