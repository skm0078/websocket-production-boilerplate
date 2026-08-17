import type { MessageHandler } from "./index";
import { heartbeatAckMessage } from "../types";

/**
 * heartbeat: application-level liveness (in addition to ws ping/pong).
 * The client uses this for its own dead-connection detection; the server
 * replies with heartbeat_ack carrying the original id for correlation.
 */
export const heartbeatHandler: MessageHandler = async (deps, connection, message) => {
  deps.send(connection, heartbeatAckMessage(message.id));
};
