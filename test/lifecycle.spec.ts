import * as cacheLib from "../src/index.js";

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const f = new cacheLib.CacheManager<string>([
  new cacheLib.MemoryCache(),
  new cacheLib.FileSystemCache(),
]);

await sleep(1000);

const context = f.get(`hello`);

await f.set(`hello`, `world`);

console.log(context);

context.then((v) => {
  console.log(v);
  f.get(`hello`).then((v) => {
    console.log(v);
  });
});

sleep(1000);
