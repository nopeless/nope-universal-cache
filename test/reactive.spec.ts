import { expect } from "chai";

import { Ref, computedRef } from "../src/reactive.js";

describe(`test`, function () {
  it(`should work`, function () {
    const a = new Ref(1);
    const b = new Ref(2);
    const c = computedRef(() => {
      return Math.max(a.value, b.value);
    }, [a, b]);
    expect(a.value).to.equal(1);
    expect(b.value).to.equal(2);
    expect(c.value).to.equal(2);
    a.value = 3;
    expect(c.value).to.equal(3);
    a.value = 0;
    expect(c.value).to.equal(2);
  });
});
