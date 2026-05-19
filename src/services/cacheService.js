/**
 * LIGHTWEIGHT IN-MEMORY CACHE SERVICE WITH TTL & LOGGING
 * Zero-dependency cache helper for high-performance query caching.
 */
class MemoryCache {
    constructor() {
        this.cache = new Map();
    }

    /**
     * Retrieve a value from the cache.
     * Returns null if key doesn't exist or is expired.
     */
    get(key) {
        const item = this.cache.get(key);
        if (!item) {
            console.log(`\x1b[35m[CACHE MISS] Key: ${key}\x1b[0m`);
            return null;
        }
        
        if (Date.now() > item.expiry) {
            console.log(`\x1b[33m[CACHE EXPIRED] Key: ${key}\x1b[0m`);
            this.cache.delete(key);
            return null;
        }
        
        console.log(`\x1b[32m[CACHE HIT] Key: ${key}\x1b[0m`);
        return item.value;
    }

    /**
     * Save a value in the cache with a specified Time-to-Live (TTL).
     */
    set(key, value, ttlSeconds = 10) {
        const expiry = Date.now() + ttlSeconds * 1000;
        this.cache.set(key, { value, expiry });
        console.log(`\x1b[36m[CACHE SET] Key: ${key} (TTL: ${ttlSeconds}s)\x1b[0m`);
    }

    /**
     * Delete a specific cache key.
     */
    del(key) {
        this.cache.delete(key);
        console.log(`[CACHE DELETE] Key: ${key}`);
    }

    /**
     * Clear all cached data (used for active invalidation on database writes).
     */
    flush() {
        console.log('\x1b[35m[CACHE] Active invalidation triggered: Flushing all cached data.\x1b[0m');
        this.cache.clear();
    }
}

module.exports = new MemoryCache();
