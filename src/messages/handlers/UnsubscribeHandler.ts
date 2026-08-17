import type { MessageHandler } from "./index";
import { WS_CLOSE_CODES, WebSocketError } from "../../errors/WebSocketError";
import { ackMessage } from "../types";

/** unsubscribe: leave a room. Leaving a room you were never in is a no-op, not an error. */
export const unsubscribeHandler: MessageHandler = async (deps, connection, message) => {
  if (!message.room) {
    throw new WebSocketError(WS_CLOSE_CODES.INVALID_MESSAGE, "unsubscribe requires a room");
  }

  await deps.roomAdapter.unsubscribeFromRoom(message.room, connection.id);
  connection.subscribedRooms.delete(message.room);

  if (message.requiresAck) {
    deps.send(connection, ackMessage(message.id));
  }
};
