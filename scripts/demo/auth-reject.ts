/**
 * Demonstrates: an invalid token is rejected with close code 4001.
 *
 * Usage: npx ts-node scripts/demo/auth-reject.ts
 */
import { WS_CLOSE_CODES } from "../../src/errors/WebSocketError";
import { connect, deadline, fail, heading, line, pass } from "./lib";

heading("demo: an invalid token is rejected with 4001");

const BAD_TOKEN = "not-a-real-token";
line("*", `connecting with token "${BAD_TOKEN}"`);

const ws = connect(BAD_TOKEN);
const timer = deadline(10_000, "the server to close the connection");

// The handshake completes before auth runs: WebSocketServer validates the token
// on the 'connection' event, not during the HTTP upgrade. So a client sees
// 'open' and then an immediate 4001. That is the real behaviour, and asserting
// "must never open" would assert a design this server does not have.
ws.on("open", () => line("*", "handshake completed - auth is checked on connection, not upgrade"));

ws.on("close", (code, reason) => {
  clearTimeout(timer);
  const text = reason.toString() || "(no reason given)";
  line("<", `close ${code}  ${text}`);

  if (code !== WS_CLOSE_CODES.AUTH_FAILED) {
    fail(`expected ${WS_CLOSE_CODES.AUTH_FAILED}, got ${code}`);
  }
  pass(`invalid token closed with ${code} as documented`);
});

// A transport-level error before the handshake completes is normal here: the
// server rejects during the upgrade, which surfaces as an error on some
// platforms and a close frame on others. Only 'close' decides the outcome.
ws.on("error", () => undefined);
