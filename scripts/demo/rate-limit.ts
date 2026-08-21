/**
 * Demonstrates: flooding past the per-connection message rate limit closes the
 * connection with 4002.
 *
 * Usage: npx ts-node scripts/demo/rate-limit.ts
 */
import { WS_CLOSE_CODES } from "../../src/errors/WebSocketError";
import { config, connect, deadline, describe, envelope, fail, heading, line, mintToken, pass } from "./lib";

heading(`demo: flooding past ${config.maxMessagesPerSecond} msg/s closes with 4002`);

const ROOM = "flood-test";
const BURST = config.maxMessagesPerSecond * 3;

const ws = connect(mintToken("flooder"));
const timer = deadline(20_000, "the server to rate-limit the connection");

let sent = 0;
let joined = false;

ws.on("open", () => {
  line("*", "connected");
  // PublishHandler rejects a publisher that has not joined the room, so the
  // flood has to be of valid messages - otherwise this would prove that
  // invalid messages are rejected, which is a different claim.
  ws.send(JSON.stringify(envelope("subscribe", { room: ROOM, requiresAck: true })));
  line(">", `subscribe room=${ROOM}`);
});

ws.on("message", (raw) => {
  const msg = describe(raw);
  if (msg?.type === "ack" && !joined) {
    joined = true;
    line("<", "ack - joined, starting the flood");
    line("*", `sending ${BURST} publishes as fast as possible`);
    for (let i = 0; i < BURST; i += 1) {
      if (ws.readyState !== ws.OPEN) break;
      ws.send(JSON.stringify(envelope("publish", { room: ROOM, payload: { i } })));
      sent += 1;
    }
    line(">", `${sent} publishes sent`);
    return;
  }
  if (msg?.type === "error") {
    line("<", `error ${JSON.stringify(msg.payload)}`);
  }
});

ws.on("close", (code, reason) => {
  clearTimeout(timer);
  line("<", `close ${code}  ${reason.toString() || "(no reason given)"}`);

  if (code !== WS_CLOSE_CODES.RATE_LIMITED) {
    fail(`expected ${WS_CLOSE_CODES.RATE_LIMITED}, got ${code} after ${sent} messages`);
  }
  pass(`the rate limiter fired after ${sent} messages and closed with ${code}`);
});

ws.on("error", () => undefined);
