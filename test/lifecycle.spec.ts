import { expect } from "chai";
import {
  CacheManager,
  IndependentStoreCacheWrapper,
  MemoryStore,
} from "../src/index.js";

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe(`CacheManager`, function () {
  it(`should work`, async function () {
    const c = new CacheManager<string>([
      new IndependentStoreCacheWrapper(new MemoryStore(), {
        ttl: `5ms`,
      }),
    ]);

    await c.set(`foo`, `bar`);
    expect(await c.get(`foo`)).to.equal(`bar`);
    await sleep(10);
    expect(await c.get(`foo`)).to.equal(undefined);
  });
});
