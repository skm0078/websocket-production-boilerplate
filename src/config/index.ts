/**
 * Central config: every tunable knob lives here, overridable via env vars.
 * See .env.example for the full list with comments.
 */

export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  redisUrl: string;
  jwtSecret: string;
  clientOrigin: string;
  heartbeatIntervalMs: number;
  maxHeartbeatMisses: number;
  ackTimeoutMs: number;
  maxMessageSizeBytes: number;
  maxConnectionsPerIp: number;
  maxConnectionsPerUser: number;
  maxMessagesPerSecond: number;
  metricsEnabled: boolean;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: numberFromEnv(env.PORT, 8080),
    logLevel: env.LOG_LEVEL ?? "info",
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    jwtSecret: env.JWT_SECRET ?? "change-me-in-production",
    clientOrigin: env.CLIENT_ORIGIN ?? "http://localhost:3000",
    heartbeatIntervalMs: numberFromEnv(env.HEARTBEAT_INTERVAL_MS, 25_000),
    maxHeartbeatMisses: numberFromEnv(env.MAX_HEARTBEAT_MISSES, 2),
    ackTimeoutMs: numberFromEnv(env.ACK_TIMEOUT_MS, 5_000),
    maxMessageSizeBytes: numberFromEnv(env.MAX_MESSAGE_SIZE_BYTES, 1_048_576),
    maxConnectionsPerIp: numberFromEnv(env.MAX_CONNECTIONS_PER_IP, 20),
    maxConnectionsPerUser: numberFromEnv(env.MAX_CONNECTIONS_PER_USER, 5),
    maxMessagesPerSecond: numberFromEnv(env.MAX_MESSAGES_PER_SECOND, 30),
    metricsEnabled: env.METRICS_ENABLED !== "false"
  };
}
