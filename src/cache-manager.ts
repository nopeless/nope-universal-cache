import { CacheInterface, CacheEntry } from "./cache-wrapper.js";
import { computedRef } from "./reactive.js";

class CacheManager<T> implements CacheInterface<T> {
  // In reality CacheEntry is now a computed ref now
  public entries = new Map<string, CacheEntry>();
  public caches: CacheInterface<T>[];
  /**
   * Must provide at least one cache
   */
  constructor(caches: [CacheInterface<T>, ...CacheInterface<T>[]]) {
    this.caches = caches;
  }

  async get(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (entry) {
      const missed: CacheInterface<T>[] = [];
      let val: T | undefined;
      for (const cache of this.caches) {
        val = await cache.get(key);
        if (val) {
          break;
        }
        missed.push(cache);
      }

      const v = val;
      if (v !== undefined) {
        await Promise.all(missed.map((c) => c.set(key, v)));
      }

      return v;
    } else {
      return undefined;
    }
  }

  async set(key: string, value: T): Promise<T> {
    const entry = this.entries.get(key);
    if (entry) {
      // Call updates
      await Promise.all(this.caches.map((c) => c.set(key, value)));
      return value;
    } else {
      await Promise.all(this.caches.map((c) => c.set(key, value)));

      const ttls = this.caches
        .map((c) => c.entries.get(key)?.ttl)
        .filter((v): v is Exclude<typeof v, undefined> => v !== undefined);

      const ttl = computedRef(() => {
        return Math.max(...ttls.map((v) => v.value));
      }, ttls);

      const newEntry = {
        key,
        createdAt: Date.now(),
        modifiedAt: Date.now(),
        timeout: setTimeout(() => {
          this.del(key);
        }, ttl.value).unref(),
        ttl,
      };

      ttl.hook((_, num) => {
        if (newEntry.timeout) clearTimeout(newEntry.timeout);
        setTimeout(() => {
          this.del(key);
        }, num).unref();
      });

      this.entries.set(key, newEntry);
      return value;
    }
  }

  async del(key: string): Promise<boolean> {
    const entry = this.entries.get(key);
    if (entry) {
      if (entry.timeout) clearTimeout(entry.timeout);
      this.entries.delete(key);
      return true;
    }
    return false;
  }
}

class CacheManagerPromise<T> extends CacheManager<Promise<T> | T> {
  public mapping: { [key: string]: Promise<T> } = Object.create(null);

  async set(key: string, value: T | Promise<T>): Promise<T> {
    if (value === Promise.resolve(value)) {
      this.mapping[key] = value;
      return value
        .then((v) => {
          return super.set(key, v);
        })
        .finally(() => {
          delete this.mapping[key];
        });
    } else {
      return super.set(key, value);
    }
  }

  async get(key: string): Promise<T | undefined> {
    if (key in this.mapping) return this.mapping[key];
    return super.get(key);
  }
}

export { CacheManager, CacheManagerPromise };
