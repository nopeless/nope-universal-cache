import path from "path";
import fs from "fs";
const fsp = fs.promises;

import msFunction from "ms";
import { createHash } from "crypto";

function sha256(str: string): string {
  return createHash(`sha256`).update(str).digest(`hex`);
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return Promise.resolve(value) === value;
}

type TtlOption = number | string;

type Timeout = NodeJS.Timeout & {
  _idleTimeout: number;
};

function msForTtl(v: number | string): number;
function msForTtl(v: undefined): undefined;
function msForTtl(v: number | string | undefined): number | undefined;
function msForTtl(v: number | string | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== `number`) {
    v = msFunction(v);
  }

  // Max 32 int for timeout thing
  if (v > 2147483647) {
    throw new Error(
      `ttl must be less than 2147483647 (or aproximately 24.8 days)`
    );
  }
  return v;
}

type Data<T> = {
  timeout: ReturnType<typeof setTimeout>;
  value: T;
  ttl: number | undefined;
  createdAt: number;
};

function data<T>(
  value: T,
  timeout: ReturnType<typeof setTimeout>,
  ttl: number | undefined
): Data<T> {
  return {
    timeout,
    value,
    ttl,
    createdAt: Date.now(),
  };
}

interface CacheInterface<T> {
  get(key: string): Promise<T | undefined>;
  /**
   * awaits until every process is done
   */
  set(key: string, value: T): Promise<T>;
  del(key: string): Promise<boolean | void>;
  clear(): Promise<number | void>;

  /**
   * Should return default ttl if item does not exist
   */
  getTtl(key?: string): Promise<number>;
  updateTtl(key: string, ttl: TtlOption): Promise<void>;
  /**
   * Returns whether all rejects are handled by the implementation
   */
  get rejectionSafe(): boolean;
  isShared: boolean;
}

class BaseCache {
  public ttl: number;
  constructor(options: { ttl?: TtlOption } = {}) {
    this.ttl = msForTtl(options.ttl ?? `1h`);
  }
}

class MemoryCache<T> extends BaseCache implements CacheInterface<T> {
  protected mapping = new Map<string, Data<T>>();
  public isShared: false = false;
  public readonly rejectionSafe: true = true;
  constructor(options: ConstructorParameters<typeof BaseCache>[0] = {}) {
    super(options);
  }

  async get(key: string): Promise<T | undefined> {
    return this.mapping.get(key)?.value;
  }

  async set(
    key: string,
    value: T,
    options: { ttl?: string | number } = {}
  ): Promise<T> {
    const timeout = setTimeout(() => {
      this.mapping.delete(key);
    }).unref();
    this.mapping.set(key, data(value, timeout, msForTtl(options.ttl)));
    return value;
  }

  async del(key: string): Promise<boolean | void> {
    const data = this.mapping.get(key);
    if (data) {
      clearTimeout(data.timeout);
      this.mapping.delete(key);
      return true;
    }
    return false;
  }

  async clear(): Promise<void> {
    for (const data of this.mapping.values()) {
      clearTimeout(data.timeout);
    }
    this.mapping.clear();
    return;
  }

  async getTtl(key?: string): Promise<number> {
    if (key) {
      const data = this.mapping.get(key);
      if (data) {
        return data.ttl ?? this.ttl;
      }
    }
    return this.ttl;
  }

  async updateTtl(key: string, ttl: number): Promise<void> {
    const data = this.mapping.get(key);
    if (data) {
      clearTimeout(data.timeout);
      data.timeout = setTimeout(() => {
        this.mapping.delete(key);
      }, ttl).unref();
    }
    return;
  }
}

type writeFileData = Parameters<typeof fsp[`writeFile`]>[1];

type converters<T> = {
  serialize: (
    v: T
  ) => Promise<writeFileData | undefined> | writeFileData | undefined;
  deserialize: (v: writeFileData) => Promise<T | undefined> | T | undefined;
};

class FileSystemCache<T> extends BaseCache implements CacheInterface<T> {
  protected serialize: converters<T>[`serialize`];
  protected deserialize: converters<T>[`deserialize`];
  protected hashFunction: (key: string) => string;
  protected mapping = new Map<string, ReturnType<typeof setTimeout>>();

  public isShared: boolean;
  public readonly cachePath: string;

  public fileWriteError?: (reason: Error) => void;
  public fileReadError?: (reason: Error) => void;
  public fileDeleteError?: (reason: Error) => void;

  protected loaded = false;
  protected readonly initialLoadPromise: Promise<void>;

  get rejectionSafe(): boolean {
    return !!(this.fileWriteError && this.fileReadError);
  }

  constructor(
    options: ConstructorParameters<typeof BaseCache>[0] & {
      fileWriteError?: (reason: Error) => void;
      fileReadError?: (reason: Error) => void;
      fileDeleteError?: (reason: Error) => void;

      /**
       * Serialize and deserialize should not reject and instead return undefined
       * If you want warnings, add to the catch
       */
      serialize?: converters<T>[`serialize`];
      deserialize?: converters<T>[`deserialize`];

      basePath?: string;
      hashFunction?: (key: string) => string;

      isShared?: boolean;
    } = {}
  ) {
    super(options);

    this.isShared = options.isShared ?? true;

    this.fileWriteError = options.fileWriteError;
    this.fileReadError = options.fileReadError;
    this.fileDeleteError = options.fileDeleteError;

    // If you found this comment because you tried to change the serializer
    // after it has been passed to the constructor, make an issue as I didn't think
    // that would happen
    const { serialize, deserialize } = options;
    this.serialize = serialize
      ? async (arg) => serialize(arg)
      : async (arg) => JSON.stringify(arg);
    this.deserialize = deserialize
      ? async (arg) => deserialize(arg)
      : async (arg: writeFileData) => JSON.parse(arg.toString());
    this.hashFunction = options.hashFunction ?? sha256;

    this.cachePath = path.join(process.cwd(), options.basePath ?? `.cache`);

    if (this.cachePath.length + 64 + 1 > 260) {
      throw new Error(`cachePath is too long`);
    }

    this.initialLoadPromise = this.load();
  }

  /**
   * ```js
   * fs.promises.unlink
   * ```
   */
  async unlink(hash: string): ReturnType<typeof fsp[`unlink`]> {
    return fsp
      .unlink(path.join(this.cachePath, hash))
      .catch((e) =>
        this.fileDeleteError ? this.fileDeleteError(e) : Promise.reject(e)
      );
  }

  /**
   * ```js
   * fs.promises.readFile
   * ```
   */
  async read(
    hash: string
  ): Promise<undefined | Awaited<ReturnType<typeof fsp[`readFile`]>>> {
    return fsp.readFile(path.join(this.cachePath, hash)).catch((e) => {
      if (e.code === `ENOENT`) {
        return undefined;
      }
      return this.fileReadError
        ? (this.fileReadError(e) as undefined)
        : Promise.reject(e);
    });
  }

  /**
   * ```js
   * fs.promises.writeFile
   * ```
   */
  async write(
    hash: string,
    data: writeFileData
  ): ReturnType<typeof fsp[`writeFile`]> {
    return fsp
      .writeFile(path.join(this.cachePath, hash), data)
      .catch((e) =>
        this.fileWriteError ? this.fileWriteError(e) : Promise.reject(e)
      );
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    await fsp.mkdir(this.cachePath, { recursive: true });
    const dir = await fsp.readdir(this.cachePath);
    const promises = dir.map((hash) =>
      fsp.stat(path.join(this.cachePath, hash)).then((stat): void => {
        if (!stat.isFile()) return void this.unlink(hash);
        const ttl = msForTtl(stat.atimeMs - Date.now() + this.ttl);
        if (ttl < 0) return;
        this.mapping.set(
          hash,
          setTimeout(() => {
            this.mapping.delete(hash);
            this.unlink(hash);
          }, ttl).unref()
        );
      })
    );
    return Promise.all(promises).then(() => undefined);
  }

  async get(key: string): Promise<T | undefined> {
    await this.initialLoadPromise.catch(() => 0);
    const hash = this.hashFunction(key);
    const data = await this.read(hash);
    if (!data) return undefined;
    const deserialized = await this.deserialize(data);
    if (!deserialized) return undefined;
    return deserialized;
  }

  async set(
    key: string,
    value: T,
    options: { ttl?: TtlOption } = {}
  ): Promise<T> {
    await this.initialLoadPromise.catch(() => 0);
    const hash = this.hashFunction(key);
    const serialized = await this.serialize(value);
    if (!serialized) return value;
    await this.write(hash, serialized);
    const ttl = msForTtl(options.ttl) ?? this.ttl;
    if (ttl < 0) return value;
    this.mapping.set(
      hash,
      setTimeout(() => {
        this.mapping.delete(hash);
        this.unlink(hash);
      }, ttl).unref()
    );
    return value;
  }

  async del(key: string): Promise<void> {
    await this.initialLoadPromise.catch(() => 0);
    const hash = this.hashFunction(key);
    await this.unlink(hash);
    const timeout = this.mapping.get(hash);
    if (timeout) {
      clearTimeout(timeout);
      this.mapping.delete(hash);
    }
  }

  async clear(): Promise<void> {
    await this.initialLoadPromise.catch(() => 0);
    const dir = await fsp.readdir(this.cachePath);
    const promises = dir.map((hash) => this.unlink(hash));
    await Promise.all(promises);
    for (const timeout of this.mapping.values()) {
      clearTimeout(timeout);
    }
    this.mapping.clear();
  }

  async getTtl(key?: string): Promise<number> {
    if (key) {
      const hash = this.hashFunction(key);
      const timeout = this.mapping.get(hash);
      if (timeout) return (timeout as Timeout)._idleTimeout;
    }
    return this.ttl;
  }

  async updateTtl(key: string, ttl?: TtlOption): Promise<void> {
    ttl = msForTtl(ttl) ?? this.ttl;
    const hash = this.hashFunction(key);
    const timeout = this.mapping.get(hash);
    if (timeout) {
      clearTimeout(timeout);
      this.mapping.set(
        hash,
        setTimeout(() => {
          this.mapping.delete(hash);
          this.unlink(hash);
        }, ttl).unref()
      );
    }
  }
}

class CacheManager<T> implements CacheInterface<T | Promise<T>> {
  protected promiseCache: { [key: string]: Promise<T> } = Object.create(null);
  constructor(private readonly caches: CacheInterface<T>[]) {
    return;
  }

  get rejectionSafe(): boolean {
    return this.caches.every((cache) => cache.rejectionSafe);
  }

  get isShared(): boolean {
    return this.caches.some((cache) => cache.isShared);
  }

  async get(key: string): Promise<T | undefined> {
    const promises: Promise<void>[] = [];
    const ttls = this.caches.map((c) => c.getTtl(key));
    let i = 0;
    let v;
    for (; i < this.caches.length; i++) {
      v = await this.caches[i].get(key);
      if (v === undefined) {
        continue;
      }
    }

    if (v === undefined) {
      return undefined;
    }

    // Value is found
    // Set ttl for all caches

    const hitIndex = i;
    const hitValue = v;

    // Missed
    for (let mi = 0; mi < hitIndex; mi++) {
      const c = this.caches[mi];
      promises.push(c.set(key, hitValue).then(() => undefined));
    }

    // Need highest ttl for this
    promises.push(
      Promise.all(ttls.slice(hitIndex)).then((values) => {
        const caches = this.caches.slice(hitIndex);
        if (values.length === 0) return;
        // Get index of value with highest value
        const maxIndex = values.reduce((acc, cur, index) =>
          acc === undefined ? 0 : cur > values[acc] ? index : acc
        );

        const longestTtl = values[maxIndex];

        // Hit and below
        let hi = hitIndex;
        for (; hi < caches.length; hi++) {
          if (hi === maxIndex) break;
          const c = caches[hi];
          promises.push(
            c.updateTtl(
              key,
              Math.min(Date.now() + longestTtl, values[hi]) - Date.now()
            )
          );
        }
        hi++;
        // Past no operation cache
        for (; hi < caches.length; hi++) {
          const c = caches[hi];
          if (c.isShared) {
            promises.push(c.del(key).then(() => undefined));
          } else {
            promises.push(
              c.updateTtl(
                key,
                Math.min(Date.now() + longestTtl, values[hi]) - Date.now()
              )
            );
          }
        }
      })
    );

    // Skip unhandled rejection stuff
    if (!this.rejectionSafe) {
      await Promise.all(promises);
    }

    return hitValue;
  }

  async set(key: string, value: Promise<T> | T): Promise<T> {
    if (isPromise(value)) {
      this.promiseCache[key] = value;
      return value
        .then((v) => {
          return this.set(key, v);
        })
        .finally(() => {
          delete this.promiseCache[key];
        });
    } else {
      await Promise.all(this.caches.map((c) => c.set(key, value))).then(
        () => undefined
      );
      return value;
    }
  }

  async del(key: string): Promise<void> {
    await Promise.all(this.caches.map((c) => c.del(key))).then(() => undefined);
  }

  async clear(): Promise<void> {
    await Promise.all(this.caches.map((c) => c.clear())).then(() => undefined);
  }

  async getTtl(key?: string): Promise<number> {
    return Promise.all(this.caches.map((c) => c.getTtl(key))).then((values) =>
      Math.max(...values)
    );
  }

  async updateTtl(key: string, ttl?: TtlOption): Promise<void> {
    ttl = msForTtl(ttl);
    const finalTtl = ttl ?? (await this.getTtl());

    await Promise.all(this.caches.map((c) => c.updateTtl(key, finalTtl))).then(
      () => undefined
    );
  }
}

interface ForeignProxyConstructor {
  new <T, H extends object>(target: T, handler: ProxyHandler<H>): H;
}

function ProxyCache<T>(instance: CacheInterface<T>) {
  if (!instance.rejectionSafe) {
    throw new Error(`ProxyCache: instance is not rejection safe`);
  }
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
  } & CacheInterface<T>;
}

export { MemoryCache, FileSystemCache, CacheManager, ProxyCache };
