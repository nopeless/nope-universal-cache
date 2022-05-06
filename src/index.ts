import path from "path";
import fs from "fs";
const fsp = fs.promises;

import ms from "ms";
import { createHash } from "crypto";

interface CacheInterface<T> {
  has(key: string): Promise<boolean>;

  get(key: string, ...args): Promise<T | undefined>;
  getSync?(key: string, ...args): T | undefined;
  /**
   * Returns the value itself
   * ```ts
   *   const res = await cache[id] ??= fn();
   * ```
   */
  set(key: string, value: T, ...args): Promise<T>;
  setSync?(key: string, value: T, ...args): T;
  // While these methods are listed as async
  // It is not required to wait
  del(key: string, ...args): Promise<boolean | void>;
  clear(...args): Promise<void | number>;
}

type Data<T> = {
  timeout: ReturnType<typeof setTimeout>;
  value: T;
};

function data<T>(value: T, timeout: ReturnType<typeof setTimeout>): Data<T> {
  return {
    timeout,
    value,
  };
}

function milliseconds(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === `string`) return ms(v);
  return v;
}

function sha256(str: string): string {
  return createHash(`sha256`).update(str).digest(`hex`);
}

type baseOptions = {
  ttl?: number | string;
};

class BaseCache {
  public ttl: number;
  constructor(options: baseOptions) {
    this.ttl = milliseconds(options.ttl) ?? 5 * 60 * 1000;
    // Max 32 bit signed int
    if (this.ttl > 2147483647) {
      throw new Error(
        `ttl must be less than 2147483647 (or aproximately 24.8 days)`
      );
    }
  }
}

class MemoryCache<T> extends BaseCache implements CacheInterface<T> {
  private mapping = new Map<string, Data<T>>();
  constructor(
    protected options: baseOptions & {
      store?: boolean;
    } = {}
  ) {
    super(options);
    this.ttl = milliseconds(options.ttl) ?? 5 * 60 * 1000;
  }

  async has(key: string): ReturnType<CacheInterface<T>[`has`]> {
    return this.mapping.has(key);
  }

  async get(key: string): ReturnType<CacheInterface<T>[`get`]> {
    return this.mapping.get(key)?.value;
  }

  async set(
    key: string,
    value: Promise<T> | T,
    options: {
      ttl?: number | string;
    } = {}
  ): ReturnType<CacheInterface<T>[`set`]> {
    // Do not store promises
    value = (await value) as Awaited<T>;
    const entry = this.mapping.get(key);
    if (entry) {
      clearTimeout(entry.timeout);
    }
    const timeout = setTimeout(() => {
      this.mapping.delete(key);
    }, milliseconds(options.ttl) ?? this.ttl).unref();

    this.mapping.set(key, data(value, timeout));

    return value;
  }

  async del(key: string): Promise<boolean> {
    const entry = this.mapping.get(key);
    if (entry) {
      clearTimeout(entry.timeout);
      this.mapping.delete(key);
      return true;
    }
    return false;
  }

  async clear(): Promise<number> {
    let count = 0;
    for (const [key, entry] of this.mapping.entries()) {
      clearTimeout(entry.timeout);
      this.mapping.delete(key);
      count++;
    }
    return count;
  }
}

type writeFileData = Parameters<typeof fsp[`writeFile`]>[1];

type converters<T> = {
  serialize: (v: T) => Promise<writeFileData> | writeFileData;
  deserialize: (v: writeFileData) => Promise<T> | T;
};

class FileSystemCache<T> extends BaseCache implements CacheInterface<T> {
  protected rejectionHandler: (reason: Error) => void;
  protected serialize: (v: T) => Promise<writeFileData>;
  protected deserialize: (v: writeFileData) => Promise<T>;
  protected hashFunction: (key: string) => string;
  protected mapping = new Map<string, ReturnType<typeof setTimeout>>();

  public readonly cachePath: string;

  protected loaded = false;
  protected readonly initialLoadPromise: Promise<void>;

  constructor(
    options: baseOptions & {
      rejectionHandler: (reason: Error) => void;
      serialize?: converters<T>[`serialize`];
      deserialize?: converters<T>[`deserialize`];
      basePath?: string;
      hashFunction?: (key: string) => string;
    }
  ) {
    super(options);
    this.rejectionHandler = options.rejectionHandler;
    // If you found this comment because you tried to change the serializer
    // after it has been passed to the constructor, make an issue as I didn't think
    // that would happen
    const { serialize, deserialize } = options;
    this.serialize = serialize
      ? async (arg) => serialize(arg)
      : async (arg) => JSON.stringify(arg);
    this.deserialize = deserialize
      ? async (arg) => deserialize(arg)
      : async (arg: string) => JSON.parse(arg);
    this.hashFunction = options.hashFunction ?? sha256;

    this.cachePath = options.basePath ?? path.join(process.cwd(), `.cache`);

    if (this.cachePath.length + 64 + 1 > 260) {
      throw new Error(`cachePath is too long`);
    }

    this.initialLoadPromise = this.load()
      .catch((e) => this.rejectionHandler(e))
      .finally(() => {
        this.loaded = true;
      });
  }

  async del(hash: string) {
    clearTimeout(this.mapping.get(hash) as NodeJS.Timeout);
    this.mapping.delete(hash);
    return fsp
      .unlink(path.join(this.cachePath, hash))
      .then(() => true)
      .catch((e) => {
        this.rejectionHandler(e);
        return false;
      });
  }
  protected async read(hash: string): Promise<T | undefined> {
    const filePath = path.join(this.cachePath, hash);
    return fsp
      .readFile(filePath)
      .then((data) => this.deserialize(data))
      .catch((e) => {
        this.rejectionHandler(e);
        return undefined;
      });
  }

  async has(key: string): Promise<boolean> {
    const hash = this.hashFunction(key);
    return fsp
      .stat(path.join(this.cachePath, hash))
      .then(() => true)
      .catch((e) => {
        if (e.code === `ENOENT`) {
          return false;
        }
        this.rejectionHandler(e);
        return false;
      });
  }

  async get(key: string) {
    const hash = this.hashFunction(key);
    if (this.mapping.has(hash)) {
      // Managed by us
      const timeout = this.mapping.get(hash);
      if (timeout !== undefined) clearTimeout(timeout);

      // Set new timeout
      this.mapping.set(
        hash,
        setTimeout(() => {
          this.mapping.delete(hash);
          this.del(hash);
        }, this.ttl).unref()
      );
      return this.read(hash);
    } else {
      // Managed by someone else
      return this.read(hash);
    }
  }

  async set(key: string, value: T) {
    const hash = this.hashFunction(key);
    console.log(key, hash);
    const timeout = setTimeout(() => {
      this.mapping.delete(hash);
      this.del(hash);
    }, this.ttl).unref();
    this.mapping.set(hash, timeout);
    this.serialize(value)
      .then((data) => fsp.writeFile(path.join(this.cachePath, hash), data))
      .catch((e) => {
        this.rejectionHandler(e);
      });
    return value;
  }

  async load() {
    let dir: string[] = [];
    try {
      dir = await fsp.readdir(this.cachePath);
    } catch (err) {
      await fsp.mkdir(this.cachePath, { recursive: true });
    }

    for (const filename of dir) {
      const stat = await fsp.stat(path.join(this.cachePath, filename));
      if (!stat.isFile()) {
        fsp.unlink(path.join(this.cachePath, filename));
        continue;
      }
      this.mapping.set(
        filename,
        setTimeout(() => {
          this.del(filename);
        }, stat.atimeMs - Date.now() + this.ttl).unref()
      );
    }
  }

  async clear(): Promise<void> {
    for (const timeout of this.mapping.values()) {
      clearTimeout(timeout);
    }
    fsp
      .unlink(this.cachePath)
      .catch((e) => {
        if (e.code === `ENOENT`) {
          return;
        }
        return e;
      })
      .catch(this.rejectionHandler);
    this.mapping.clear();
  }
}

class StatsCache<T> implements CacheInterface<T> {
  protected index = new Map<string, { hits: number }>();
  constructor() {
    return;
  }
  async has(_key: string): Promise<boolean> {
    return false;
  }
  async get(_key: string): Promise<T | undefined> {
    return undefined;
  }
  async set(_key: string, value: T): Promise<T> {
    return value;
  }
  async del(_key: string) {
    return true;
  }
  async clear() {
    return 0;
  }
}

class GeneratorCache<T> implements CacheInterface<T> {
  protected generator: (key: string) => Promise<T>;
  constructor(options: { generator: (key: string) => Promise<T> | T }) {
    this.generator = async (key: string) => options.generator(key);
  }
  async get(key: string): Promise<T | undefined> {
    return this.generator(key);
  }
  async has(_key: string): Promise<boolean> {
    return true;
  }
  // Cannot set in a generator. Ignore
  async set(_key: string, _value: T): Promise<T> {
    return _value;
  }
  async del(_key: string): Promise<boolean> {
    return true;
  }
  async clear(): Promise<void> {
    return;
  }
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return Promise.resolve(value) === value;
}

class CacheManager<T> {
  protected promiseCache: { [key: string]: Promise<T> } = Object.create(null);
  constructor(protected options, public caches: CacheInterface<T>[]) {}
  has(key: string): boolean {
    return this.caches.some((cache) => cache.has(key));
  }
  async set(key: string, value: T | Promise<T>) {
    if (isPromise(value)) {
      // Is promise
      this.promiseCache[key] = value;
      return value
        .then((v) => {
          return this.set(key, v);
        })
        .finally(() => {
          if (value === this.promiseCache[key]) {
            delete this.promiseCache[key];
          }
        });
    } else {
      // Is value
      return Promise.any(this.caches.map((cache) => cache.set(key, value)));
    }
  }

  async get(key: string): Promise<T | undefined> {
    const missed: CacheInterface<T>[] = [];
    for (const cache of this.caches) {
      if (await cache.has(key)) {
        const v = await cache.get(key);
        if (v === undefined) {
          // Cache will fix itself
          missed.push(cache);
          continue;
        }
        missed.forEach((cache) => {
          cache.set(key, v);
        });
        return cache.get(key);
      }
      missed.push(cache);
    }
    return undefined;
  }
}

interface ForeignProxyConstructor {
  new <T, H extends object>(target: T, handler: ProxyHandler<H>): H;
}

function ProxyCache<T>(instance: CacheInterface<T>) {
  // Use lexical scoping instead
  return new (Proxy as ForeignProxyConstructor)(instance, {
    get: function (_target, name) {
      return Reflect.apply(instance.get, instance, [name]);
    },
    set: function (_target, name, value) {
      Reflect.apply(instance.set, instance, [name, value]);
      return true;
    },
    deleteProperty: function (_target, name) {
      return Reflect.apply(instance.del, instance, [name]);
    },
  }) as {
    [key: string]: Promise<T>;
  };
}

(async () => {
  const c = new CacheManager<string>({}, [
    new MemoryCache(),
    new FileSystemCache({
      rejectionHandler: console.error,
    }),
    new GeneratorCache({
      generator: async (key) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
        return `${key}-generated`;
      },
    }),
  ]);
  // console.log(`setting`);
  // await c.set(`test`, `test`);
  console.log(`getting`);
  const v = await c.get(`test2`);
  console.log(v);
})();

export { ProxyCache, CacheManager, MemoryCache, FileSystemCache, StatsCache };
