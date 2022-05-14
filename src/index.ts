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

interface CacheRoot {
  ttl: number;
}

interface CacheEntry<T> {
  prototype: CacheRoot;
  value: T;
  ttl?: number;
}

interface BaseCacheInterface<T> {
  get(key: string): Promise<T | undefined>;
  /**
   * awaits until every process is done
   */
  set(key: string, value: T): Promise<T>;
  del(key: string): Promise<boolean | void>;
  clear(): Promise<number | void>;
}

interface CacheInterface<T> extends BaseCacheInterface<T> {
  /**
   * Should return default ttl if item does not exist
   */
  expiresAt(key?: string): Promise<number>;
  updateTtl(key: string, ttl: TtlOption): Promise<void>;
  /**
   * Returns whether all rejects are handled by the implementation
   */
  get rejectionSafe(): boolean;
  isShared: boolean;
  entries: Map<string, CacheEntry<T>>;
  listeners: WeakSet<CacheManager<T>>;
}

interface CacheManager<T> extends BaseCacheInterface<T> {
  caches: CacheInterface<T>;
}

class BaseCache<T> {
  public ttl: number;
  // public entries: CacheEntryManager<T>;
  constructor(options: { ttl?: TtlOption } = {}) {
    this.ttl = msForTtl(options.ttl ?? `1h`);
  }
}

class SomeStore<T> {
  public readonly rejectionSafe = false;

  constructor() {
    const a = 1;
  }
  create(key: string, value: value) {
    // create stuff
  }
  read(key: string) {
    // read stuff
  }
  update(key: string, newValue: T) {
    // update stuff
  }
  delete(key: string) {
    // delete stuff
  }
  clear() {
    // clear all entries
  }
}

class CacheWrapper<T> {
  constructor(store, options) {
    this.store = store;
    this.options = options;
    this.listeners = new WeakSet();
  }

  get() {
    return this.store.read();
  }
  set() {}
  del() {}
  clear() {}
}

class CacheManager<T> {}
