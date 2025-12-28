import { LRUCache } from 'lru-cache';
import { config } from '../config';
import { logger } from './logger';
import type { CacheStats } from '../types';

// Cache value wrapper with metadata
interface CacheEntry<T> {
  value: T;
  cachedAt: Date;
  contentType: string;
}

// Create LRU cache instance
const cache = new LRUCache<string, CacheEntry<unknown>>({
  max: config.cacheMaxSize,
  ttl: config.cacheTtlSeconds * 1000,
  updateAgeOnGet: false,
  updateAgeOnHas: false,
});

// Track hit/miss statistics
let hits = 0;
let misses = 0;

/**
 * Get an item from the cache
 */
export function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key) as CacheEntry<T> | undefined;

  if (entry) {
    hits++;
    logger.debug(`Cache hit: ${key}`);
    return entry.value;
  }

  misses++;
  logger.debug(`Cache miss: ${key}`);
  return undefined;
}

/**
 * Set an item in the cache
 */
export function cacheSet<T>(key: string, value: T, contentType: string = 'unknown'): void {
  const entry: CacheEntry<T> = {
    value,
    cachedAt: new Date(),
    contentType,
  };

  cache.set(key, entry);
  logger.debug(`Cache set: ${key} (type: ${contentType})`);
}

/**
 * Check if an item exists in the cache
 */
export function cacheHas(key: string): boolean {
  return cache.has(key);
}

/**
 * Delete an item from the cache
 */
export function cacheDelete(key: string): boolean {
  const deleted = cache.delete(key);
  if (deleted) {
    logger.debug(`Cache deleted: ${key}`);
  }
  return deleted;
}

/**
 * Clear the entire cache
 */
export function cacheClear(): void {
  cache.clear();
  hits = 0;
  misses = 0;
  logger.info('Cache cleared');
}

/**
 * Get cache statistics
 */
export function cacheStats(): CacheStats {
  const total = hits + misses;
  return {
    size: cache.size,
    maxSize: config.cacheMaxSize,
    hitRate: total > 0 ? hits / total : 0,
    hits,
    misses,
  };
}

/**
 * Generate a cache key from request parameters
 */
export function generateCacheKey(prefix: string, params: Record<string, unknown>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  return `${prefix}:${sortedParams}`;
}

/**
 * Get all keys matching a prefix
 */
export function cacheKeysByPrefix(prefix: string): string[] {
  const keys: string[] = [];
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Delete all entries matching a prefix
 */
export function cacheDeleteByPrefix(prefix: string): number {
  const keys = cacheKeysByPrefix(prefix);
  keys.forEach(key => cache.delete(key));
  logger.info(`Deleted ${keys.length} cache entries with prefix: ${prefix}`);
  return keys.length;
}

/**
 * Get remaining TTL for a key in milliseconds
 */
export function cacheTTL(key: string): number | undefined {
  return cache.getRemainingTTL(key);
}

export { cache };
