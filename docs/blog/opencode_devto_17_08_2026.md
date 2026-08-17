---
title: "Real-Time WebSocket Systems: Beyond the Tutorial — What Your Live App Actually Needs in Production"
published: false
description: "WebSocket tutorials stop at 'it works on localhost.' Real production systems need heartbeats, acks, backoff with jitter, rate limits, auth, Redis-backed rooms, metrics, and graceful shutdown. Here's the full journey."
tags: websocket, nodejs, typescript, backend
canonical_url: null
cover_image: https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-02-tests-passing.png
---

> **Status:** Draft ready · screenshots embedded (GitHub raw URLs)

---

## The Story: Telos Boss's First Real Users

![Metrics Endpoint](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-06-metrics-endpoint.png)

Telos Boss is the CTO of a six-person startup. Their live-auction platform has been in beta for three months, and tonight is the first big public auction: 5,000 registered users, one antique vase, and a countdown timer that everyone can see.

Her team built the real-time layer over a weekend. It was a tutorial project, honestly: a WebSocket server with a `socket.on('message')`, a room map, and a "it works on localhost" moment. The team high-fived, pushed it, and went back to the marketing deck.

At 8:00 PM, the countdown hits zero.

Telos Boss's phone buzzes with an alert: **P95 latency crossed 4 seconds.** Then another: **memory climbing.** Then the pager goes off. The bid button is broken for everyone. The auction — the one they've been building toward for months — is frozen.

Telos Boss opens the dashboard. 5,000 sockets are connected. 4,000 of them are zombies: phones that drove through tunnels, laptops that went to sleep, tabs that were closed and reopened. The server never found out. It's sending bids into the void and holding memory for dead connections. A few users hammer the refresh button, and now 5,000 new sockets pile on top of the zombies, and Redis — the poor thing — is screaming.

Sound familiar? It's not the story of a bad team. It's the story of every WebSocket system that never left the tutorial. **The tutorial teaches you the happy path. Production is designed for the failure path.**

Over the next few minutes, Telos Boss and her team rebuild the real-time layer properly. This is what they build — and what you can build with them.

## What We're Building

![Typecheck Passing](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-03-typecheck-passing.png)

A production-grade WebSocket server — `websocket-production-boilerplate` — in Node.js 20 + TypeScript, with:

- **Heartbeat detection** (zombie killer)
- **Message envelopes with ACKs** (request-response over WebSocket)
- **Reconnect with exponential backoff + jitter** (client)
- **Message queueing with a cap** (client)
- **Rooms with Redis pub/sub** (horizontal scaling)
- **Rate limiting** (three dials)
- **Security** (JWT auth, origin validation, zod, size limits)
- **Observability** (JSON logs, /health, /metrics)
- **Tests** (the failure paths, with fakes)
- **Deployment** (multi-stage Docker, non-root, graceful shutdown)

## The Stack

![Docker Compose Up](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-04-docker-compose-up.png)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20.x | Mature WS ecosystem, single-threaded event loop fits socket I/O |
| Language | TypeScript 5.x strict | The envelope protocol is a contract; type it |
| WebSocket | `ws` | The de-facto standard, battle-tested |
| Backbone | Redis 7.x | Pub/sub for rooms across instances |
| Validation | zod | Schema at every boundary |
| Tests | jest + ts-jest | Fake sockets, fake timers |
| Ops | Docker Compose | One command to run the whole stack |

## Project Structure

![Project Structure](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-02-tests-passing.png)

```
websocket-production-boilerplate/
├── src/
│   ├── config/          # every tunable knob, env-driven
│   ├── errors/          # close-code taxonomy (4001-4006)
│   ├── logging/         # JSON logger + Prometheus metrics
│   ├── connection/      # state machine + ConnectionManager (heartbeat)
│   ├── messages/        # envelope, router, handlers
│   ├── rooms/           # RoomManager + Redis adapter
│   ├── rate-limit/      # connection + message limits
│   ├── security/        # auth, origin, sanitizer
│   └── server/          # WS lifecycle + HTTP endpoints
├── client/              # ReconnectingWebSocket for the browser
├── tests/               # fakeSocket + unit tests
├── scripts/             # test.sh, deploy.sh, gen-token.ts
├── Dockerfile           # multi-stage, non-root
└── docker-compose.yml   # app + redis
```

## Phase 1 — The Zombie Detector (Heartbeat)

![Tests Passing](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-02-tests-passing.png)

The first thing Telos Boss fixes is the 4,000 zombies.

**Why TCP alone fails you:** TCP was designed for a world where connections end. It has no idea that your user's phone went into a tunnel and dropped the link without a close frame. The OS eventually notices (after minutes), and the browser eventually notices (after hours). Your server notices *never* — unless you check.

**The pattern:**

- Every **25 seconds**, the server pings every connection.
- Each connection has an `alive` flag. On ping: `alive = false`. On pong: `alive = true`, misses reset.
- At the next tick, if the connection was still `alive = false`, it missed a pong → `misses++`.
- After **2 misses**, call `socket.terminate()` — not `close()`.

Why `terminate()` and not `close()`? Because `close()` asks for a close handshake. A dead client can never handshake. You'd wait forever. `terminate()` nukes the TCP connection immediately. It's the difference between firing someone with a conversation and firing them with a security guard.

```ts
private checkHeartbeats(): void {
  for (const connection of this.connections.values()) {
    if (connection.state.state !== ConnectionState.OPEN) continue;

    if (connection.alive === false) {
      connection.heartbeatMisses += 1;
      if (connection.heartbeatMisses >= this.opts.maxHeartbeatMisses) {
        this.terminate(connection, `no pong for ${connection.heartbeatMisses} consecutive intervals`);
        continue;
      }
    }
    connection.alive = false;
    connection.socket.ping();
  }
}
```

**The cleanup discipline:** when a connection closes — for any reason — reject every pending ACK promise, strip every listener, remove it from every room. Leaked timers and unresolved promises are the silent killers of WS servers.

**Telos Boss's lesson:** her 4,000 zombies died within ~75 seconds of the fix deploying. Memory flatlined. The auction went back up. (Story-wise, they lost the first lot to a bid timer bug, but the platform survived — which is the whole point of production engineering.)

## Phase 2 — The Envelope: Turning Fire-and-Forget Into Request-Response

![Typecheck Passing](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-03-typecheck-passing.png)

Raw `{ type, payload }` messages are fine until something goes wrong — and then you have nothing to point at.

Telos Boss's team wraps every message in an **envelope**:

```ts
{
  id: "m-123",          // correlation: acks, dedupe, debugging
  type: "publish",      // publish | subscribe | unsubscribe | ack | error | heartbeat | heartbeat_ack
  room: "auction-1",    // target room (for room ops)
  payload: { bid: 250 },
  timestamp: 1730000000000,
  requiresAck: true     // "tell me you actually handled this"
}
```

Every envelope is validated with **zod** at the router — before any handler sees it. Malformed frames are a protocol error, not a code path.

**The ACK pattern:** when `requiresAck` is true, the receiver replies with an `ack` envelope carrying the original `id`. The sender keeps a `pendingAcks` map: `messageId → { resolve, reject, timer }`. Timer fires after **5 seconds** → reject. Ack arrives → resolve and clear the timer.

```ts
requestResponse(connection, message, timeoutMs = this.opts.ackTimeoutMs): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      connection.pendingAcks.delete(message.id);
      reject(new Error(`ack timeout for message ${message.id}`));
    }, timeoutMs);
    connection.pendingAcks.set(message.id, { resolve, reject, timer });
    this.send(connection, message);
  });
}
```

**Why ACKs?** WebSocket gives you *delivery* — bytes sent. It does not give you *processing* — bytes handled. The bid that reaches the server but crashes in a handler is a lost bid. ACKs are the foundation for retry, dedupe, and "the user knows it worked."

## Phase 3 — The Reconnect Dance: Backoff, Jitter, and the Queue

![Docker Compose Up](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-04-docker-compose-up.png)

Telos Boss's users hammered refresh because the client just gave up. The new client doesn't give up — it dances.

**The state machine:** `connecting → connected → reconnecting → disconnected`. The UI can show exactly what's happening. No more mystery spinners.

**The backoff:** `minDelay = 1s`, `maxDelay = 30s`, `multiplier = 2`, `jitter = ±15%`.

```
attempt 1: ~1s    (±15%)
attempt 2: ~2s
attempt 3: ~4s
attempt 4: ~8s
attempt 5: ~16s
attempt 6+: ~30s (capped)
```

**Why jitter?** This is the subtle one. Without jitter, a thousand clients reconnect in lockstep after a network blip. The server survives the outage and then dies *afterwards* — the thundering herd. Jitter breaks the synchronization. A tiny random wobble is the difference between a stampede and a crowd.

**The queue:** while disconnected, outgoing messages queue. Cap: **1000**. Past the cap, drop the oldest and count it. A queue is a buffer, not a memory bomb. A stale message is worth less than a live client.

```ts
send(data: unknown): boolean {
  if (this.socket?.readyState === WebSocket.OPEN) {
    this.socket.send(JSON.stringify(data));
    return true;
  }
  if (this.queue.length >= this.opts.maxQueueSize) {
    this.queue.shift();
    this.droppedCount += 1;
  }
  this.queue.push(data);
  return false;
}
```

## Mid-Way Summary

![Health Endpoint](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-05-health-endpoint.png)

Three things you know now that you didn't ten minutes ago:

1. **Heartbeats kill zombies** — ping/pong with a miss counter and `terminate()`, never `close()`, for the dead.
2. **Envelopes + ACKs turn fire-and-forget into request-response** — ids, pending maps, and timeouts are how you get "the server actually handled it."
3. **Backoff without jitter is a stampede** — exponential delay desynchronized by jitter, plus a capped queue, keeps clients alive and servers breathing.

The next three phases protect the server from *itself*: rooms that scale, limits that bite, and walls that keep attackers out.

## Phase 4 — Rooms That Scale: Redis Pub/Sub

![Health Endpoint](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-05-health-endpoint.png)

Single-instance rooms are a `Map<room, Set<connection>>`. The moment Telos Boss's auction gets two instances, the map lies: instance A doesn't know what instance B's clients joined.

**The Redis pattern:**

- Every instance keeps a **local** `RoomManager` (bidirectional maps: room → connections, connection → rooms).
- Every instance runs a **RedisRoomAdapter**: a publisher client and a subscriber client (two connections on purpose — Redis recommends a dedicated connection for subscribers).
- Channel per room: `room:auction-1`. An instance subscribes when its first local member joins, and — with ref-counting — unsubscribes when the last leaves.
- A publish goes to the channel. **Every instance receives it, including the publisher's.** One path, consistent ordering, no local fast-path special cases.

```ts
async publishToRoom(room: string, message: MessageEnvelope): Promise<void> {
  await this.pubSub.publish(`room:${room}`, JSON.stringify(message));
}

async subscribeToRoom(room: string, connectionId: string): Promise<void> {
  this.roomManager.addToRoom(room, connectionId);
  await this.pubSub.subscribe(`room:${room}`); // ref-counted
}
```

**The interface trick:** the server talks to a `RoomAdapter` interface, not to Redis. Two implementations, same shape: `RedisRoomAdapter` for production, `InMemoryRoomAdapter` for tests. Swapping is one line.

## Phase 5 — The Three Dials: Rate Limiting

![Metrics Endpoint](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-06-metrics-endpoint.png)

A fast client loop (or a bot) can out-shout everyone. Three dials:

| Dial | Limit | Stops |
|---|---|---|
| Per-IP connection cap | 20 | one compromised client opening 10k sockets |
| Per-user connection cap | 5 | tab-spam and scripted duplicates |
| Per-second message cap | 30 per connection | CPU and downstream flooding |

On violation: send an `error` envelope with the code, then close with the mapped code. **Rate-limit rejections should be loud, not silent.**

```ts
if (!this.opts.messageRateLimiter.allow(connection.id)) {
  this.sendErrorAndClose(
    connection,
    new WebSocketError(WS_CLOSE_CODES.RATE_LIMITED, "message rate limit exceeded")
  );
  return;
}
```

## Phase 6 — The Walls: Security

![Wscat Connect](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-07-wscat-connect.png)

Four walls, cheapest first:

1. **Origin validation** — CSWSH (Cross-Site WebSocket Hijacking): a malicious page opens a socket *as your logged-in user* because cookies ride along on the upgrade. Browsers send `Origin`; check it against an allowlist before anything else.

2. **JWT auth on the handshake** — the browser WebSocket API can't set headers, so the token rides in `?token=`. The decoded `sub` becomes the userId everything keys on. (Caveat: it can leak into access logs — rotate tokens.)

3. **zod sanitization** — the envelope schema guarantees shape; a payload schema guards contents. Anything that doesn't parse is `INVALID_MESSAGE` before it reaches a handler.

4. **Size limits** — `maxPayload: 1MB` at the `ws` server level. Reject giants before parsing. Cheap rejection is the best rejection.

## Phase 7 — The Boring Parts: Observability, Tests, Deployment

![Publish Subscribe](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-08-publish-subscribe.png)

**Observability:**
- JSON logs, one line per event: `{ timestamp, level, service, instance, message, ...context }`. Grep-able, shippable.
- `/health` — the orchestrator's liveness question.
- `/metrics` — Prometheus text format. Alert on the canaries, not the CPU: `ws_messages_dropped_total`, `ws_errors_total`, `ws_connections_active`.

**Tests:** hand-rolled `FakeSocket` (an EventEmitter that records `send`, simulates `message`/`pong`/`close`) beats a mocking framework — tests read like prose. Fake timers drive the heartbeat kill-path, the most dangerous code in the file.

**Deployment:**
- Multi-stage Docker build: dependencies compiled in stage 1, runtime image carries only prod deps + `dist`.
- **Non-root user** — a container that can write its own files can be pwned.
- Healthcheck wired to `/health`.
- **Graceful shutdown** (`SIGTERM`): stop accepting → drain sockets → close Redis → exit 0, with a 10s force-exit backstop.

## Production Readiness Checklist

![Reconnect Demo](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-09-reconnect-demo.png)

**Before you deploy a WebSocket server, tick every box:**

- [ ] Heartbeat: ping interval < proxy idle timeout; `terminate()` on zombies
- [ ] Zombies die within a bounded time (~75s with defaults)
- [ ] Every message has an `id`; acks have timeouts; pending maps are cleared on close
- [ ] Client: exponential backoff with jitter; max delay capped
- [ ] Client: outgoing queue capped, drops counted and surfaced
- [ ] Rate limits: per-IP, per-user, per-second — tuned to real traffic
- [ ] Origin allowlist; JWT auth; token rotation plan
- [ ] zod schemas on every envelope; payload schemas for app data
- [ ] `maxPayload` set; giant frames rejected before parsing
- [ ] JSON logs; `/health`; `/metrics` with drop/error alerts
- [ ] Tests for the failure paths (heartbeat kill, rate limit, close cleanup)
- [ ] Graceful shutdown on `SIGTERM`; non-root container; healthcheck
- [ ] nginx/LB: `proxy_read_timeout` > heartbeat window; `proxy_buffering off`
- [ ] Sticky sessions (or accept resubscribe churn)
- [ ] WSS in production. Always.

## Caveats — Where This Design Bites

![Rate Limit Close](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-10-rate-limit-close.png)

1. **Proxies are silent killers.** nginx's default `proxy_read_timeout` is 60s — *shorter* than our 75s zombie window. Set `proxy_read_timeout 300s` and `proxy_buffering off`, or your load balancer kills your heartbeats before your server does.
2. **Redis is a single point of failure** in this design. It dies → cross-instance rooms die. Production needs Sentinel/Cluster, or Redis Streams for durability.
3. **Sticky sessions matter.** Without them, every reconnect re-subscribes Redis channels on another instance. Works, but churns.
4. **Browser limits:** ~6 concurrent WebSocket connections per host. A tab explosion silently starves connections.
5. **Mobile NATs kill idle sockets** after 30s–5min. Your heartbeat interval must be shorter than the NAT timeout — or your users look "connected" while they're actually cut off.
6. **The analogy breaks here:** a WebSocket is not a phone call. It's a two-way pipe with no memory. Messages arrive out of order, twice, or not at all. "Dialing and hanging up" is a story; in code, expect the worst and design for it.
7. **Heartbeat numbers are environment-specific.** 25s/2-misses is a starting point. A chat at 1 msg/min and a trading feed at 1000 msg/s need different tolerances.
8. **Exactly-once is a lie** at this layer. At-least-once + client-side dedupe by message `id` is the honest target.

## FAQ

![Auth Reject](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-11-auth-reject.png)

**Q: Why not just rely on TCP keepalive?** A: It's minutes-to-hours granularity and middleboxes often filter it. App-level ping/pong is fast and observable.

**Q: Do I really need ACKs for everything?** A: No. Fire-and-forget is fine for presence pings and analytics. Use `requiresAck` for anything where "the server actually handled it" matters — bids, orders, state changes.

**Q: What happens when Redis dies?** A: In this design: connections survive, rooms degrade (publishes fail loudly, logged). That's a conscious trade — see Caveats #2.

**Q: How do I test a WebSocket server?** A: Fakes for unit tests (deterministic, fast), then a real client (`wscat` or a browser tab) against the running server for the final proof. Both are in this repo's workflow.

**Q: One instance is fine for my app — do I still need Redis?** A: No — swap in the `InMemoryRoomAdapter` and skip Redis. The interface makes that a one-line change. (But if you deploy two instances "later," you'll be glad the adapter exists.)

## Interview Prep — The Same Ideas, The Other Way Around

![Tests Passing](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-02-tests-passing.png)

This section doubles as interview practice. The full Q&A bank (with answers) lives in `docs/LEARNINGS.md` — here are the highlights:

1. How does WebSocket heartbeat detection work? Why not TCP keepalive?
2. What happens when a client vanishes without a close frame?
3. How do you scale WebSockets horizontally?
4. Why jitter in exponential backoff?
5. What is CSWSH and how do you prevent it?
6. How do you rate limit WebSocket traffic?
7. Room delivery vs. user delivery — what's the difference?
8. How do you "guarantee" message delivery?
9. Sticky sessions — what and why?
10. What's the biggest difference between a demo and a production WebSocket server?

## The Closing Story

![Browser Console](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-12-browser-console.png)

Telos Boss's team shipped the rebuild on a Tuesday. The next auction — a vintage typewriter, 2,000 bidders — ran for 40 minutes with **zero pager alerts**. The dashboard showed something the team had never seen: a flat memory line. Clean green metrics. A hundred zombies terminated in the first minute by heartbeats that actually checked.

Telos Boss watched the final bid land: 3,400 dollars, acknowledged by the server, visible to all 2,000 screens within 200 milliseconds.

"First time it's ever gone smoothly," her engineer said.

"That's the point," Telos Boss said. "When it works, it looks like nothing happened."

That's production WebSocket engineering. The happy path is easy. The failure path is the product. Build for the failure path — and your app gets to be the one where nothing happens.

---

**Telos Boss's checklist — the tl;dr of this whole post:**

- [ ] Heartbeats that kill zombies (25s ping, 2 misses, `terminate()`)
- [ ] Envelopes with ids; ACKs with timeouts
- [ ] Client: backoff ×2 capped at 30s, jittered ±15%, queue capped at 1000
- [ ] Rooms on Redis pub/sub, behind a swap-in adapter
- [ ] Rate limits: IP / user / per-second
- [ ] Origin + JWT + zod + size limits
- [ ] /health, /metrics, JSON logs, alerts on drops
- [ ] Tests for the failure paths
- [ ] Multi-stage Docker, non-root, graceful shutdown
- [ ] Proxy timeouts and sticky sessions configured before launch

---

**Like this post?** Star the repo and try it yourself:

![Repo Tree](https://raw.githubusercontent.com/skm0078/websocket-production-boilerplate/master/docs/screenshots/screenshot-02-tests-passing.png)

```bash
git clone https://github.com/your-username/websocket-production-boilerplate.git
cd websocket-production-boilerplate
npm ci && npm run typecheck && npm test
docker compose up -d --build
```

The complete, runnable code is in the repo — `websocket-production-boilerplate`. Clone it, run it, and find your own Telos Boss story to tell.
