import { Redis } from "@upstash/redis";
import { getConfig, hasRedis } from "./config";

export type StoreKind = "memory" | "redis";

/**
 * The only way the app reads or writes shared state. Values are JSON, so a
 * value read back is never the same object that was written.
 */
export interface CacheStore {
  readonly kind: StoreKind;
  /** The stored value, or null when missing or expired. */
  get<T>(key: string): Promise<T | null>;
  /** Stores a JSON-serializable value that expires after `ttlSeconds`. */
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  /** Adds one to a counter. The TTL starts when the counter is created. Returns the new value. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  del(key: string): Promise<void>;
}

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/** Per-process store for local dev and tests. Not shared between Vercel instances. */
export class MemoryStore implements CacheStore {
  readonly kind = "memory" as const;
  private entries = new Map<string, MemoryEntry>();

  private live(key: string): MemoryEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.live(key);
    return entry ? (JSON.parse(entry.value) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.set(key, {
      value: JSON.stringify(value),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.live(key);
    const next = entry ? Number(JSON.parse(entry.value)) + 1 : 1;
    this.entries.set(key, {
      value: JSON.stringify(next),
      expiresAt: entry ? entry.expiresAt : Date.now() + ttlSeconds * 1000,
    });
    return next;
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Upstash Redis over REST. JSON is handled here, not by the client, so both stores behave the same. */
export class RedisStore implements CacheStore {
  readonly kind = "redis" as const;

  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get<string>(key);
    return raw === null || raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const next = await this.redis.incr(key);
    if (next === 1) await this.redis.expire(key, ttlSeconds);
    return next;
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

let singleton: CacheStore | null = null;

/** Redis when the Vercel Upstash variables are set, otherwise the in-memory store. */
export function getCache(): CacheStore {
  if (singleton) return singleton;
  const config = getConfig();
  const { KV_REST_API_URL: url, KV_REST_API_TOKEN: token } = config;
  if (hasRedis(config) && url && token) {
    singleton = new RedisStore(
      new Redis({ url, token, automaticDeserialization: false }),
    );
  } else {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "KV_REST_API_URL/KV_REST_API_TOKEN not set: using in-memory cache, counters will not be shared",
      );
    }
    singleton = new MemoryStore();
  }
  return singleton;
}

/** Drops the singleton so the next getCache() re-reads the environment. Tests only. */
export function resetCache(): void {
  singleton = null;
}
