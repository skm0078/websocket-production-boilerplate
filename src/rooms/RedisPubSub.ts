/**
 * RedisPubSub: thin wrapper over ioredis for the pub/sub pattern.
 *
 * Two clients on purpose: Redis docs recommend a dedicated connection for
 * subscribers, and a busy subscriber client would stall our publishes.
 *
 * Channel subscriptions are ref-counted: subscribe() twice, unsubscribe()
 * once, and the channel stays open — two local connections to one room must
 * not tear down the channel under each other.
 */
import Redis from "ioredis";
import { EventEmitter } from "events";
import type { StructuredLogger } from "../logging/Logger";

export class RedisPubSub {
  private readonly emitter = new EventEmitter();
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly channelRefs = new Map<string, number>();
  private readonly logger: StructuredLogger;

  constructor(redisUrl: string, logger: StructuredLogger) {
    this.logger = logger;
    this.publisher = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
    this.subscriber = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });

    this.subscriber.on("message", (channel, raw) => this.emitter.emit("message", channel, raw));
    this.subscriber.on("error", (err) => this.logger.error("redis_subscriber_error", { error: err.message }));
    this.publisher.on("error", (err) => this.logger.error("redis_publisher_error", { error: err.message }));
  }

  async connect(): Promise<void> {
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }

  async publish(channel: string, payload: string): Promise<void> {
    await this.publisher.publish(channel, payload);
  }

  async subscribe(channel: string): Promise<void> {
    const refs = this.channelRefs.get(channel) ?? 0;
    if (refs === 0) await this.subscriber.subscribe(channel);
    this.channelRefs.set(channel, refs + 1);
  }

  async unsubscribe(channel: string): Promise<void> {
    const refs = this.channelRefs.get(channel) ?? 0;
    if (refs <= 1) {
      this.channelRefs.delete(channel);
      await this.subscriber.unsubscribe(channel);
    } else {
      this.channelRefs.set(channel, refs - 1);
    }
  }

  onMessage(callback: (channel: string, raw: string) => void): void {
    this.emitter.on("message", callback);
  }
}
