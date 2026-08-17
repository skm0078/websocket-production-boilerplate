/**
 * RoomAdapter: the transport contract for room messages.
 *
 * Two implementations, same shape:
 *   - InMemoryRoomAdapter — for tests and single-instance development
 *   - RedisRoomAdapter    — Redis pub/sub backbone for horizontal scaling
 *
 * The server never talks to Redis directly — it talks to this interface.
 */
import type { MessageEnvelope } from "../messages/types";

export interface RoomAdapter {
  publishToRoom(room: string, message: MessageEnvelope): Promise<void>;
  subscribeToRoom(room: string, connectionId: string): Promise<void>;
  unsubscribeFromRoom(room: string, connectionId: string): Promise<void>;
  /** Fired for every message published to a room this instance receives. */
  onRoomMessage(callback: (room: string, message: MessageEnvelope) => void): void;
}
