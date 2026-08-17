# websocket-production-boilerplate

Production-grade WebSocket server boilerplate. Not a chat demo with a room map — a server designed for the failure path: heartbeats, acks, backoff, rate limits, security, Redis-backed rooms, metrics, and graceful shutdown.

**Companion post:** [Real-Time WebSocket Systems: Beyond the Tutorial](https://dev.to) (draft lives in `docs/blog/`).

## Features

- **Heartbeat zombie detection** — 25s ping / 2 missed pongs → `terminate()`
- **Message envelopes + ACKs** — request-response over WebSocket with 5s timeouts
- **Rooms on Redis pub/sub** — channel-per-room, ref-counted, swap-in adapter
- **Reconnecting client** — backoff 1s→30s ×2, ±15% jitter, queue capped at 1000
- **Rate limiting** — per-IP, per-user, per-second (three dials)
- **Security** — JWT auth, origin validation (CSWSH), zod envelopes, 1MB payload cap
- **Observability** — JSON logs, `/health`, `/metrics` (Prometheus)
- **Tests** — failure paths covered with fakes
- **Ops-ready** — multi-stage Docker, non-root, graceful shutdown

## Quickstart

```bash
# 1. install
npm ci

# 2. typecheck + test
make test

# 3. run the full stack (app + redis)
make docker-up

# 4. connect a client
npm run build && node dist/scripts/gen-token.js alice
#   -> copy the token, then:
#   (the -o origin is required: CLI clients are rejected without an Origin header)
#   npx wscat -c "ws://localhost:8080?token=<TOKEN>" -o "http://localhost:3000"
```

Or without Docker: start Redis (`redis-server`), then `npm run dev`.

> No `make` on Windows? `npm run typecheck` + `npm test` cover the same ground (`docker compose up -d --build` replaces `make docker-up`).

## Architecture

```
Client (ReconnectingWebSocket)
   │  ws://host?token=<jwt>
   ▼
ProductionWebSocketServer ── OriginValidator ── Auth(JWT) ── ConnectionRateLimiter
   │  message pipeline
   ▼
MessageRouter ── size limit → JSON parse → zod envelope → sanitize → handler
   │                                   │
   ├── handlers: publish/subscribe/unsubscribe/heartbeat
   │              └── RoomAdapter ◄── InMemoryRoomAdapter (tests)
   │                                 └── RedisRoomAdapter (prod) → Redis pub/sub
   ├── ConnectionManager ── heartbeat loop ── terminate() zombies
   ├── MessageRateLimiter (per-connection, sliding 1s window)
   └── Metrics / StructuredLogger ── /health, /metrics
```

## Environment

See [`.env.example`](.env.example). Everything is tunable:

| Variable | Default | Meaning |
|---|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `8080` | bind address / port |
| `REDIS_URL` | `redis://localhost:6379` | pub/sub backbone |
| `JWT_SECRET` | `change-me-in-production` | **change it** |
| `CLIENT_ORIGIN` | `http://localhost:3000` | allowed Origin header |
| `HEARTBEAT_INTERVAL_MS` | `25000` | ping frequency |
| `MAX_HEARTBEAT_MISSES` | `2` | missed pongs before terminate |
| `ACK_TIMEOUT_MS` | `5000` | server→client ack wait |
| `MAX_MESSAGE_SIZE_BYTES` | `1048576` | max frame size (1MB) |
| `MAX_CONNECTIONS_PER_IP` | `20` | per-IP socket cap |
| `MAX_CONNECTIONS_PER_USER` | `5` | per-user socket cap |
| `MAX_MESSAGES_PER_SECOND` | `30` | per-connection msg cap |
| `LOG_LEVEL` | `info` | debug/info/warn/error |
| `METRICS_ENABLED` | `true` | expose `/metrics` (Prometheus) |

## Wire Protocol

Every frame is a JSON envelope, validated by zod:

```json
{ "id": "m-123", "type": "publish", "room": "auction-1", "payload": {"bid": 250}, "timestamp": 1730000000000, "requiresAck": true }
```

| Type | Direction | Meaning |
|---|---|---|
| `publish` | client → server | broadcast to `room` (must be subscribed) |
| `subscribe` / `unsubscribe` | client → server | join / leave `room` |
| `heartbeat` / `heartbeat_ack` | both | app-level liveness |
| `ack` | both | reply to a `requiresAck` message (carries `messageId`) |
| `error` | server → client | error envelope before close |

### Close codes (the contract)

| Code | Meaning |
|---|---|
| `4001` | auth failed / origin not allowed |
| `4002` | rate limited |
| `4003` | message too large |
| `4004` | invalid message (malformed JSON / schema violation / protocol error) |
| `4006` | connection limit reached |

## Testing

```bash
make test          # typecheck + jest
make coverage
```

(Windows, no `make`: `npm run typecheck && npm test`, `npm run coverage`.)

- `tests/fakeSocket.ts` — hand-rolled ws fake (no mocking framework)
- `tests/connection.test.ts` — heartbeat kill-path with fake timers, ack cleanup, shutdown
- `tests/rooms.test.ts` — bidirectional membership, adapter fan-out
- `tests/rate-limit.test.ts` — IP/user/message caps, window slide

## Deployment

```bash
make deploy        # docker compose build + up
```

- Multi-stage Dockerfile: build deps → runtime (prod deps only, **non-root**)
- Healthcheck → `/health`; graceful shutdown on `SIGTERM` (10s force-exit backstop)
- Behind a proxy: set `proxy_read_timeout 300s` (heartbeat window is 75s by default), `proxy_buffering off`, and use sticky sessions (`ip_hash`) — or accept resubscribe churn.

## License

MIT — see [LICENSE](LICENSE). Built with Telos Kitty.
