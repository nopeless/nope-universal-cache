import { Ref } from "./reactive.js";
import { GenericStore, TtlOption } from "./types.js";
import { msForTtl } from "./util.js";

interface CacheEntry {
  ttl: Ref<number>;
  key: string;
  createdAt: number;
  modifiedAt: number;
  timeout: ReturnType<typeof setTimeout> | null;
}

interface CacheInterface<T> {
  entries: Map<string, CacheEntry>;
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, options?: { ttl?: TtlOption }): Promise<T>;
}

class IndependentStoreCacheWrapper<T> implements CacheInterface<T> {
  protected ttl: number;
  protected cacheEntryPrototype: {
    readonly ttl: {
      readonly value: number;
    };
  };

  public entries = new Map<string, CacheEntry>();

  constructor(public store: GenericStore<T>, options: { ttl?: TtlOption }) {
    this.ttl = msForTtl(options.ttl ?? `10s`);

    const o = {
      ttl: {},
    };
    Reflect.defineProperty(o.ttl, `value`, {
      writable: false,
      get: () => this.ttl,
    });
    this.cacheEntryPrototype = o as {
      readonly ttl: { readonly value: number };
    };
  }

  async get(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (entry && entry.timeout) {
      entry.timeout.refresh();
    }
    return this.store.read(key);
  }

  async set(key: string, value: T, options: { ttl?: TtlOption }): Promise<T> {
    const entry = this.entries.get(key);
    if (entry) {
      // TODO remove after unit testing
      if (!entry.timeout) {
        console.warn(`invalid state has been reached. stack:`);
        console.warn(new Error().stack);
      } else {
        entry.timeout.refresh();
      }
      await this.store.update(key, value);
    } else {
      const newEntry = Object.create(this.cacheEntryPrototype);
      newEntry.key = key;
      newEntry.createdAt = Date.now();
      newEntry.modifiedAt = newEntry.createdAt;
      newEntry.ttl = new Ref(0);
      if (options.ttl) {
        // Self property
        newEntry.ttl.value = msForTtl(options.ttl);
      }
      newEntry.timeout = setTimeout(() => {
        this.del(key);
        newEntry.timeout = null;
      }, newEntry.ttl).unref();

      this.entries.set(key, newEntry);

      await this.store.create(key, value);
    }
    return value;
  }

  async del(key: string): Promise<boolean> {
    const entry = this.entries.get(key);
    if (entry && entry.timeout) clearTimeout(entry.timeout);
    this.entries.delete(key);
    return this.store.delete(key);
  }

  async clear(): Promise<number> {
    for (const entry of this.entries.values()) {
      if (entry.timeout) clearTimeout(entry.timeout);
    }
    return this.store.clear();
  }
}

export { CacheInterface, CacheEntry, IndependentStoreCacheWrapper };
