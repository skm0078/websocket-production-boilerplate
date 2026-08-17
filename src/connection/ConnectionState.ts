/**
 * Connection state machine. Transitions are validated so a connection can never
 * silently skip states (e.g. CLOSED -> OPEN). Invalid moves throw — catch early.
 */

export enum ConnectionState {
  CONNECTING = "connecting",
  OPEN = "open",
  CLOSING = "closing",
  CLOSED = "closed"
}

const VALID_TRANSITIONS: Record<ConnectionState, ConnectionState[]> = {
  [ConnectionState.CONNECTING]: [ConnectionState.OPEN, ConnectionState.CLOSING, ConnectionState.CLOSED],
  [ConnectionState.OPEN]: [ConnectionState.CLOSING, ConnectionState.CLOSED],
  [ConnectionState.CLOSING]: [ConnectionState.CLOSED],
  [ConnectionState.CLOSED]: []
};

export class ConnectionStateMachine {
  private current: ConnectionState = ConnectionState.CONNECTING;
  private readonly onTransition?: (from: ConnectionState, to: ConnectionState) => void;

  constructor(onTransition?: (from: ConnectionState, to: ConnectionState) => void) {
    this.onTransition = onTransition;
  }

  get state(): ConnectionState {
    return this.current;
  }

  transition(to: ConnectionState): void {
    if (!VALID_TRANSITIONS[this.current].includes(to)) {
      throw new Error(`Invalid connection transition: ${this.current} -> ${to}`);
    }
    const from = this.current;
    this.current = to;
    this.onTransition?.(from, to);
  }
}
