import type { MessageHandler } from "./index";
import { WS_CLOSE_CODES, WebSocketError } from "../../errors/WebSocketError";
import { ackMessage } from "../types";

/**
 * publish: broadcast a message to a room. The publisher must be subscribed to
 * the room first — publishing to a room you don't belong to is a protocol error.
 */
export const publishHandler: MessageHandler = async (deps, connection, message) => {
  if (!message.room) {
    throw new WebSocketError(WS_CLOSE_CODES.INVALID_MESSAGE, "publish requires a room");
  }
  if (!connection.subscribedRooms.has(message.room)) {
    throw new WebSocketError(
      WS_CLOSE_CODES.INVALID_MESSAGE,
      `not subscribed to room: ${message.room}`
    );
  }

  await deps.roomAdapter.publishToRoom(message.room, message);
  if (message.requiresAck) {
    deps.send(connection, ackMessage(message.id));
  }
};
