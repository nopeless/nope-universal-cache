import path from "path";
import rimraf from "rimraf";
import { Suite } from "mocha";

const CACHE_DIR = path.resolve(process.cwd(), `cache`);

function clean() {
  rimraf.sync(CACHE_DIR);
}

export const mochaHooks = {
  beforeAll: () => {
    console.log(`cleaning cache dir...`);
    clean();
  },
  afterAll: function () {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let topParent = (this as any).test;

    while (topParent.parent) topParent = topParent.parent;

    function isFailed(suite: Suite) {
      // Suites are recursive
      for (const s of suite.suites) {
        if (isFailed(s)) return true;
      }
      // Tests are not
      for (const test of suite.tests) {
        if (test.state === `failed`) return true;
      }
      return false;
    }
    isFailed(topParent) || clean();
  },
};

export const cacheFile = CACHE_DIR;
