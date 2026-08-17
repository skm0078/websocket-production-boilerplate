/**
 * FakeSocket: a hand-rolled stand-in for a ws WebSocket.
 *
 * Why not a mocking library? Because tests read like prose this way:
 *   socket.simulateMessage(...)  -> server thinks a frame arrived
 *   socket.simulatePong()        -> server thinks the client is alive
 *   socket.sent                  -> what the server actually sent
 *
 * It mirrors ws's EventEmitter interface (on/emit) and its readyState codes.
 */
import { EventEmitter } from "events";

export const SOCKET_STATES = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
} as const;

export class FakeSocket extends EventEmitter {
  readyState: number = SOCKET_STATES.OPEN;
  sent: string[] = [];
  terminated = false;
  closeCalled = false;
  closeCode: number | null = null;
  closeReason = "";

  /** Capture what the server would put on the wire. */
  send(data: string): void {
    this.sent.push(data);
  }

  ping(): void {
    // no-op: a real socket would send a control frame
  }

  /** The sledgehammer: nukes the TCP connection, no close handshake. */
  terminate(): void {
    this.terminated = true;
    this.readyState = SOCKET_STATES.CLOSED;
    this.emit("close", 1006, Buffer.from("terminated"));
  }

  /** Graceful close with a handshake (code 1005 when none given, like ws). */
  close(code?: number, reason?: string): void {
    this.closeCalled = true;
    this.closeCode = code ?? null;
    this.closeReason = reason ?? "";
    this.readyState = SOCKET_STATES.CLOSED;
    this.emit("close", code ?? 1005, Buffer.from(reason ?? ""));
  }

  /** Test helper: pretend a frame arrived from the client. */
  simulateMessage(data: string): void {
    this.emit("message", Buffer.from(data));
  }

  /** Test helper: pretend the client answered a ping. */
  simulatePong(): void {
    this.emit("pong");
  }
}
