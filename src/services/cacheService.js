/**
 * LIGHTWEIGHT IN-MEMORY CACHE SERVICE WITH TTL
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
        if (!item) return null;
        
        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }
        return item.value;
    }

    /**
     * Save a value in the cache with a specified Time-to-Live (TTL).
     */
    set(key, value, ttlSeconds = 10) {
        const expiry = Date.now() + ttlSeconds * 1000;
        this.cache.set(key, { value, expiry });
    }

    /**
     * Delete a specific cache key.
     */
    del(key) {
        this.cache.delete(key);
    }

    /**
     * Clear all cached data (used for active invalidation on database writes).
     */
    flush() {
        console.log('[CACHE] Active invalidation triggered: Flushing all cached dashboard and stats data.');
        this.cache.clear();
    }
}

module.exports = new MemoryCache();
