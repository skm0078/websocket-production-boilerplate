/**
 * RedisRoomAdapter: the production room transport.
 *
 * How it scales: every instance subscribes to the channels of rooms its local
 * connections joined. A publish goes to `room:<id>`; every instance with
 * members in that room receives it and fans out locally. Single source of
 * truth for ordering: all instances (including the publisher's) receive via
 * the same channel — one consistent path, no local fast-path special cases.
 */
import { EventEmitter } from "events";
import type { RoomAdapter } from "./RoomAdapter";
import type { RoomManager } from "./RoomManager";
import { RedisPubSub } from "./RedisPubSub";
import type { MessageEnvelope } from "../messages/types";
import type { StructuredLogger } from "../logging/Logger";

const ROOM_MESSAGE_EVENT = "room-message";
const ROOM_CHANNEL_PREFIX = "room:";

export class RedisRoomAdapter implements RoomAdapter {
  private readonly emitter = new EventEmitter();
  private readonly pubSub: RedisPubSub;

  constructor(
    private readonly roomManager: RoomManager,
    redisUrl: string,
    logger: StructuredLogger
  ) {
    this.pubSub = new RedisPubSub(redisUrl, logger);
    this.pubSub.onMessage((channel, raw) => {
      if (!channel.startsWith(ROOM_CHANNEL_PREFIX)) return;
      try {
        const message = JSON.parse(raw) as MessageEnvelope;
        this.emitter.emit(ROOM_MESSAGE_EVENT, channel.slice(ROOM_CHANNEL_PREFIX.length), message);
      } catch {
        logger.error("room_adapter_bad_payload", { channel });
      }
    });
  }

  async connect(): Promise<void> {
    await this.pubSub.connect();
  }

  async disconnect(): Promise<void> {
    await this.pubSub.disconnect();
  }

  async publishToRoom(room: string, message: MessageEnvelope): Promise<void> {
    await this.pubSub.publish(`${ROOM_CHANNEL_PREFIX}${room}`, JSON.stringify(message));
  }

  async subscribeToRoom(room: string, connectionId: string): Promise<void> {
    // Redis first, membership second: a failed subscribe (Redis down) must not
    // leave an orphaned local member who would never receive messages.
    await this.pubSub.subscribe(`${ROOM_CHANNEL_PREFIX}${room}`);
    this.roomManager.addToRoom(room, connectionId);
  }

  async unsubscribeFromRoom(room: string, connectionId: string): Promise<void> {
    const removed = this.roomManager.removeFromRoom(room, connectionId);
    if (removed) {
      await this.pubSub.unsubscribe(`${ROOM_CHANNEL_PREFIX}${room}`);
    }
  }

  onRoomMessage(callback: (room: string, message: MessageEnvelope) => void): void {
    this.emitter.on(ROOM_MESSAGE_EVENT, callback);
  }
}
