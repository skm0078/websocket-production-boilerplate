/**
 * InMemoryRoomAdapter: same contract as RedisRoomAdapter, zero dependencies.
 * Used by unit tests and single-instance development.
 */
import { EventEmitter } from "events";
import type { RoomAdapter } from "./RoomAdapter";
import type { RoomManager } from "./RoomManager";
import type { MessageEnvelope } from "../messages/types";

const ROOM_MESSAGE_EVENT = "room-message";

export class InMemoryRoomAdapter implements RoomAdapter {
  private readonly emitter = new EventEmitter();

  constructor(private readonly roomManager: RoomManager) {}

  async publishToRoom(room: string, message: MessageEnvelope): Promise<void> {
    this.emitter.emit(ROOM_MESSAGE_EVENT, room, message);
  }

  async subscribeToRoom(room: string, connectionId: string): Promise<void> {
    this.roomManager.addToRoom(room, connectionId);
  }

  async unsubscribeFromRoom(room: string, connectionId: string): Promise<void> {
    this.roomManager.removeFromRoom(room, connectionId);
  }

  onRoomMessage(callback: (room: string, message: MessageEnvelope) => void): void {
    this.emitter.on(ROOM_MESSAGE_EVENT, callback);
  }
}
