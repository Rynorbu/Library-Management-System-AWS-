import { config } from '../config.js';

/**
 * Catalogue cache. Uses Amazon ElastiCache (Redis) when REDIS_URL is set,
 * otherwise a small in-memory TTL cache. Invalidation uses a version number
 * baked into each key, so bumping the version invalidates every cached page at once.
 */
let redis = null;
const memory = new Map();
let memoryVersion = 1;

export async function initCache() {
  if (!config.redisUrl) {
    console.log('[cache] using in-memory cache');
    return;
  }
  try {
    const { createClient } = await import('redis');
    redis = createClient({ url: config.redisUrl, socket: { connectTimeout: 3000, reconnectStrategy: (n) => Math.min(n * 200, 5000) } });
    redis.on('error', (err) => console.error('[cache] redis error', err.message));
    await redis.connect();
    console.log('[cache] connected to Redis / ElastiCache');
  } catch (err) {
    console.error('[cache] Redis unavailable, falling back to memory:', err.message);
    redis = null;
  }
}

const redisReady = () => redis && redis.isReady;

async function version() {
  if (redisReady()) {
    try {
      return (await redis.get('catalog:version')) || '1';
    } catch {
      /* fall through */
    }
  }
  return String(memoryVersion);
}

export async function cached(key, ttlSeconds, producer) {
  const fullKey = `catalog:v${await version()}:${key}`;
  if (redisReady()) {
    try {
      const hit = await redis.get(fullKey);
      if (hit) return JSON.parse(hit);
      const value = await producer();
      await redis.set(fullKey, JSON.stringify(value), { EX: ttlSeconds });
      return value;
    } catch (err) {
      console.error('[cache] redis op failed:', err.message);
      return producer();
    }
  }
  const hit = memory.get(fullKey);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await producer();
  memory.set(fullKey, { value, expires: Date.now() + ttlSeconds * 1000 });
  if (memory.size > 500) memory.delete(memory.keys().next().value);
  return value;
}

/** Call whenever a book's data or availability changes. */
export async function invalidateCatalog() {
  memoryVersion += 1;
  memory.clear();
  if (redisReady()) {
    try {
      await redis.incr('catalog:version');
    } catch (err) {
      console.error('[cache] invalidate failed:', err.message);
    }
  }
}

export function cacheMode() {
  return redisReady() ? 'redis' : 'memory';
}
