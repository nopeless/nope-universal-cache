import { expect } from "chai";
import {
  CacheManager,
  CacheManagerPromise,
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

    expect(await c.get(`foo`)).to.equal(undefined);
    await c.set(`foo`, `bar`);
    expect(c.get(`foo`)).to.be.a.instanceof(Promise);
    expect(await c.get(`foo`)).to.equal(`bar`);
    await sleep(10);
    expect(await c.get(`foo`)).to.equal(undefined);
  });
  it(`should work (promise)`, async function () {
    const c = new CacheManagerPromise<string>([
      new IndependentStoreCacheWrapper(new MemoryStore(), {
        ttl: `10ms`,
      }),
    ]);

    expect(await c.get(`foo`)).to.equal(undefined);
    await c.set(`foo`, `bar`);
    expect(c.get(`foo`)).to.be.a.instanceof(Promise);
    expect(await c.get(`foo`)).to.equal(`bar`);
    await sleep(10);
    expect(await c.get(`foo`)).to.equal(undefined);

    await c.set(
      `foo`,
      (async () => {
        await sleep(2);
        return `bar`;
      })()
    );

    await sleep(2);
    expect(await c.get(`foo`)).to.equal(`bar`);
    await sleep(7);
    expect(await c.get(`foo`)).to.equal(undefined);
  });
});
