import { createHash } from "crypto";
import msFunction from "ms";

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

function sha256(str: string): string {
  return createHash(`sha256`).update(str).digest(`hex`);
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return Promise.resolve(value) === value;
}

export { msForTtl, sha256, isPromise };
