/**
 * Demonstrates: the shipped ReconnectingWebSocket survives a server restart and
 * backs off exponentially while the server is down.
 *
 * This drives client/ReconnectingWebSocket.ts - the real client, not a
 * hand-rolled one - so the delays printed here are what a consumer of this
 * boilerplate actually gets.
 *
 * Requires Docker: it stops and starts the server container mid-session.
 *
 * Usage: npx ts-node scripts/demo/reconnect.ts
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import { ReconnectingWebSocket } from "../../client/ReconnectingWebSocket";
import { WS_CLOSE_CODES } from "../../src/errors/WebSocketError";
import { config, deadline, fail, heading, line, mintToken, pass } from "./lib";

/**
 * Node 20 has no global WebSocket, and ReconnectingWebSocket targets the browser
 * API, so `ws` stands in and the client under test runs unmodified.
 *
 * The Origin header is injected here because a browser sets it automatically and
 * `ws` does not. Without it the origin wall closes every connection with 4001 -
 * and because auth runs after the handshake, the client reports "connected"
 * first. An earlier version of this demo did exactly that and printed a
 * transcript that read like a successful reconnect while actually showing
 * repeated auth rejection.
 */
class OriginWebSocket extends WebSocket {
  constructor(url: string, protocols?: string | string[]) {
    super(url, protocols, { origin: config.clientOrigin });
  }
}
Object.assign(globalThis, { WebSocket: OriginWebSocket });

const run = promisify(exec);
const CONTAINER = "websocket-production-boilerplate-websocket-1";
const DOWN_FOR_MS = 6_000;

heading("demo: the client reconnects with exponential backoff after a restart");

const attempts: number[] = [];
let restartStarted = false;
let settled = false;

const timer = deadline(90_000, "the client to reconnect after the server restart");

const rws = new ReconnectingWebSocket(
  `ws://localhost:${config.port}?token=${mintToken("reconnect-demo")}`
);

rws.onstatechange = (state) => {
  line("*", `state -> ${state}`);
  // Success is only meaningful after the scripted restart. Accepting a
  // "connected" before then is how the earlier false positive happened.
  if (state === "connected" && restartStarted && attempts.length > 0 && !settled) {
    settled = true;
    clearTimeout(timer);
    finish();
  }
};

rws.onreconnect = (attempt, delayMs) => {
  attempts.push(delayMs);
  line("<", `reconnect attempt ${attempt} in ${delayMs}ms`);
};

rws.onclose = (event) => {
  // 4001 means the connection was rejected, not dropped by a restart - a
  // different claim, and not the one this demo makes.
  if (event.code === WS_CLOSE_CODES.AUTH_FAILED) {
    fail("closed with 4001 - the connection was rejected, not dropped by a restart");
  }
  line("<", `close ${event.code}`);
};

function finish(): never {
  rws.close();
  line("*", `backoff delays: ${attempts.join("ms, ")}ms`);

  if (attempts.length < 2) {
    fail(`expected at least 2 attempts while the server was down, saw ${attempts.length}`);
  }
  // Each delay must exceed the previous. Asserting exact values would assert
  // away the +-15% jitter the client deliberately applies.
  for (let i = 1; i < attempts.length; i += 1) {
    const prev = attempts[i - 1] ?? 0;
    const curr = attempts[i] ?? 0;
    if (curr <= prev) fail(`delay ${i + 1} (${curr}ms) did not grow beyond ${prev}ms`);
  }
  pass(`reconnected after ${attempts.length} attempts, each delay longer than the last`);
}

rws.connect();

// exec, not execSync: execSync blocks the event loop, so the client could not
// run its backoff timers while the server was down.
void (async () => {
  await new Promise((r) => setTimeout(r, 2_000));

  restartStarted = true;
  line("*", `stopping ${CONTAINER} - simulating a deploy`);
  await run(`docker stop ${CONTAINER}`);
  line("*", `server down for ${DOWN_FOR_MS}ms, backoff grows while it is`);

  await new Promise((r) => setTimeout(r, DOWN_FOR_MS));
  line("*", "starting the server again");
  await run(`docker start ${CONTAINER}`);
})();
