import { Platform } from 'react-native';

/**
 * Cross-platform key-value store.
 * - Web: uses window.localStorage
 * - Native: uses an in-memory Map (avoids the AsyncStorage native-module crash)
 */
const createStore = () => {
  if (Platform.OS === 'web') {
    return {
      getItem: (key: string): Promise<string | null> =>
        Promise.resolve(localStorage.getItem(key)),
      setItem: (key: string, value: string): Promise<void> => {
        localStorage.setItem(key, value);
        return Promise.resolve();
      },
      removeItem: (key: string): Promise<void> => {
        localStorage.removeItem(key);
        return Promise.resolve();
      },
      getAllKeys: (): Promise<string[]> =>
        Promise.resolve(Object.keys(localStorage)),
      multiRemove: (keys: string[]): Promise<void> => {
        keys.forEach((k) => localStorage.removeItem(k));
        return Promise.resolve();
      },
    };
  }

  // In-memory store for native
  const store = new Map<string, string>();
  return {
    getItem: (key: string): Promise<string | null> =>
      Promise.resolve(store.get(key) ?? null),
    setItem: (key: string, value: string): Promise<void> => {
      store.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string): Promise<void> => {
      store.delete(key);
      return Promise.resolve();
    },
    getAllKeys: (): Promise<string[]> =>
      Promise.resolve(Array.from(store.keys())),
    multiRemove: (keys: string[]): Promise<void> => {
      keys.forEach((k) => store.delete(k));
      return Promise.resolve();
    },
  };
};

const storage = createStore();

/**
 * Cache service for storing API responses
 */
class CacheService {
  private static readonly PREFIX = 'rs_cache_';
  private static readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get a value from cache
   * @param key - Cache key
   * @returns Cached value or null if not found/expired
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await storage.getItem(`${this.PREFIX}${key}`);
      if (!cached) return null;

      const { value, timestamp, ttl } = JSON.parse(cached);
      const now = Date.now();

      if (now - timestamp > ttl) {
        // Expired, remove it
        await storage.removeItem(`${this.PREFIX}${key}`);
        return null;
      }

      return value;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Set a value in cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Time to live in milliseconds (default: 5 minutes)
   */
  static async set<T>(key: string, value: T, ttl: number = this.DEFAULT_TTL): Promise<void> {
    try {
      const item = {
        value,
        timestamp: Date.now(),
        ttl,
      };
      await storage.setItem(`${this.PREFIX}${key}`, JSON.stringify(item));
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  /**
   * Delete a value from cache
   * @param key - Cache key
   */
  static async delete(key: string): Promise<void> {
    try {
      await storage.removeItem(`${this.PREFIX}${key}`);
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }

  /**
   * Clear all cache entries
   */
  static async clear(): Promise<void> {
    try {
      const keys = await storage.getAllKeys();
      const cacheKeys = keys.filter(key => key.startsWith(this.PREFIX));
      if (cacheKeys.length > 0) {
        await storage.multiRemove(cacheKeys);
      }
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  }
}

export default CacheService;