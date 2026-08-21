/**
 * Demonstrates: a message published to a room reaches a *separate* subscriber.
 *
 * Two independent connections, so this proves fan-out through the room adapter
 * rather than an echo back to the sender.
 *
 * Two protocol details this encodes, both learned by running it:
 *   - handlers only ack when requiresAck is set, so every step asks for one
 *   - PublishHandler rejects a publisher that has not joined the room, so the
 *     publisher subscribes before it publishes
 *
 * Usage: npx ts-node scripts/demo/pubsub.ts
 */
import WebSocket from "ws";
import type { MessageEnvelope } from "../../src/messages/types";
import { connect, deadline, describe, envelope, fail, heading, line, mintToken, pass, send } from "./lib";

heading("demo: publish reaches a subscriber in the same room");

const ROOM = "auction-1";
const BID = { bid: 250 };

const timer = deadline(20_000, "the subscriber to receive the published payload");

function joinRoom(ws: WebSocket, who: string): Promise<void> {
  return new Promise((resolve) => {
    const join = (): void => {
      line("*", `${who} connected`);
      send(ws, envelope("subscribe", { room: ROOM, requiresAck: true }));
    };
    // Both connections are opened up front, so by the time this runs the socket
    // may already be OPEN - and "open" never fires again for an open socket.
    if (ws.readyState === ws.OPEN) join();
    else ws.on("open", join);
    // Detached after the join ack. Leaving it attached relabels every later ack
    // as "joined", and the transcript IS the evidence - a misleading line in it
    // is the same class of problem as a fabricated screenshot.
    const onJoinAck = (raw: WebSocket.RawData): void => {
      const msg = describe(raw);
      if (msg?.type !== "ack") return;
      line("<", `ack id=${msg.id} - ${who} joined ${ROOM}`);
      ws.off("message", onJoinAck);
      resolve();
    };
    ws.on("message", onJoinAck);
    ws.on("error", (err) => fail(`${who} errored: ${err.message}`));
  });
}

const subscriber = connect(mintToken("subscriber"));
const publisher = connect(mintToken("publisher"));

subscriber.on("message", (raw) => {
  const msg: MessageEnvelope | null = describe(raw);
  if (msg?.type !== "publish") return;

  clearTimeout(timer);
  const got = JSON.stringify(msg.payload);
  line("<", `publish room=${msg.room} payload=${got}`);

  if (got !== JSON.stringify(BID)) {
    fail(`payload mismatch: expected ${JSON.stringify(BID)}, got ${got}`);
  }
  pass(`the published payload reached a separate subscriber in ${ROOM}`);
});

void (async () => {
  // Sequenced, not raced. Publishing before the subscription is acked would
  // fail intermittently in CI for a reason that has nothing to do with the code.
  await joinRoom(subscriber, "subscriber");
  await joinRoom(publisher, "publisher");
  send(publisher, envelope("publish", { room: ROOM, payload: BID, requiresAck: true }));
})();
