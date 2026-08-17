import type { MessageHandler } from "./index";
import { WS_CLOSE_CODES, WebSocketError } from "../../errors/WebSocketError";
import { ackMessage } from "../types";

/** subscribe: join a room. Membership is tracked locally and mirrored to the room adapter. */
export const subscribeHandler: MessageHandler = async (deps, connection, message) => {
  if (!message.room) {
    throw new WebSocketError(WS_CLOSE_CODES.INVALID_MESSAGE, "subscribe requires a room");
  }

  await deps.roomAdapter.subscribeToRoom(message.room, connection.id);
  connection.subscribedRooms.add(message.room);

  if (message.requiresAck) {
    deps.send(connection, ackMessage(message.id));
  }
};
