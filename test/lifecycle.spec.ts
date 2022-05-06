import * as cacheLib from "../src/index.js";

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const f = cacheLib.ProxyCache<string>(
  new cacheLib.Cache([
    new cacheLib.PromiseCache(),
    new cacheLib.MemoryCache(),
    new cacheLib.FileSystemCache(),
    new cacheLib.GeneratorCache({
      generator: async (key) => {
        console.log(`HIT`);
        await sleep(1000);
        return `Generated ${key}`;
      },
    }),
  ])
);

await sleep(1000);

const context = f[`hello`];
console.log(context);

context.then((v) => {
  console.log(v);
});

sleep(1000);
