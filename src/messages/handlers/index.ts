import type { ManagedConnection } from "../../connection/ConnectionManager";
import type { MessageEnvelope } from "../types";
import type { RoomAdapter } from "../../rooms/RoomAdapter";
import type { StructuredLogger } from "../../logging/Logger";

/**
 * Everything a handler may need. Kept narrow on purpose: handlers are pure
 * protocol logic — they cannot touch sockets or state machines directly.
 */
export interface MessageHandlerDeps {
  roomAdapter: RoomAdapter;
  logger: StructuredLogger;
  send: (connection: ManagedConnection, message: MessageEnvelope) => void;
}

export type MessageHandler = (
  deps: MessageHandlerDeps,
  connection: ManagedConnection,
  message: MessageEnvelope
) => Promise<void>;

export { publishHandler } from "./PublishHandler";
export { subscribeHandler } from "./SubscribeHandler";
export { unsubscribeHandler } from "./UnsubscribeHandler";
export { heartbeatHandler } from "./HeartbeatHandler";
