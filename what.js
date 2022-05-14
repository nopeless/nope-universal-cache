class MyConstants {
  get foo() {
    return `foo`;
  }
}

console.log(MyConstants.foo); // 'foo'
MyConstants.foo = `bar`;
console.log(MyConstants.foo); // 'foo', a static getter's value cannot be changed
