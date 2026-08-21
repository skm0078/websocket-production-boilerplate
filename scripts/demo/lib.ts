/**
 * Shared plumbing for the demo clients.
 *
 * These scripts exist because a screenshot of someone typing into wscat proves
 * nothing a reader can re-run. A script that drives the behaviour, prints what
 * actually happened, and exits non-zero when it does not happen is evidence -
 * and it doubles as an integration check.
 *
 * Every script here must FAIL LOUDLY if the behaviour it demonstrates does not
 * occur. A demo that prints a transcript regardless of outcome is decoration.
 */
import jwt from "jsonwebtoken";
import WebSocket from "ws";
import { loadConfig } from "../../src/config";
import type { MessageEnvelope, MessageType } from "../../src/messages/types";

const cfg = loadConfig();

const DIM = "\u001b[2m";
const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const CYAN = "\u001b[36m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";

export function heading(text: string): void {
  process.stdout.write(`${CYAN}$ ${text}${RESET}\n\n`);
}

/** `>` sent, `<` received, `*` a note about what the script is doing. */
export function line(dir: ">" | "<" | "*", text: string): void {
  const colour = dir === ">" ? DIM : dir === "<" ? YELLOW : DIM;
  process.stdout.write(`  ${colour}${dir}${RESET} ${text}\n`);
}

export function pass(text: string): never {
  process.stdout.write(`\n${GREEN}PASS${RESET} ${text}\n`);
  process.exit(0);
}

export function fail(text: string): never {
  process.stdout.write(`\n${RED}FAIL${RESET} ${text}\n`);
  process.exit(1);
}

export function mintToken(sub = "demo-user"): string {
  return jwt.sign({ sub }, cfg.jwtSecret, { expiresIn: "5m" });
}

/**
 * The server validates Origin, so a client that omits it is rejected for the
 * wrong reason - which would make an auth demo prove something it did not test.
 */
export function connect(token: string): WebSocket {
  return new WebSocket(`ws://localhost:${cfg.port}?token=${token}`, {
    origin: cfg.clientOrigin
  });
}

let seq = 0;
export function envelope(type: MessageType, fields: Partial<MessageEnvelope> = {}): MessageEnvelope {
  seq += 1;
  return { id: `m-${seq}`, type, timestamp: Date.now(), ...fields };
}

export function send(ws: WebSocket, msg: MessageEnvelope): void {
  ws.send(JSON.stringify(msg));
  const room = msg.room ? ` room=${msg.room}` : "";
  line(">", `${msg.type}${room} id=${msg.id}`);
}

export function describe(raw: WebSocket.RawData): MessageEnvelope | null {
  try {
    return JSON.parse(raw.toString()) as MessageEnvelope;
  } catch {
    return null;
  }
}

/** Every demo is bounded, so a hang surfaces as a failure rather than a stall. */
export function deadline(ms: number, what: string): NodeJS.Timeout {
  return setTimeout(() => fail(`timed out after ${ms}ms waiting for ${what}`), ms);
}

export const config = cfg;
