class Timeout {
  constructor(executor, ttl) {
    this.executor = executor;
    this._ttl = ttl;
  }

  #_setTimeout() {
    this.timeout = setTimeout(() => {
      this.executor();
    }, this.ttl).unref();
  }

  get ttl() {
    return this._ttl;
  }
  set ttl(v) {
    clearTimeout(this.timeout);
    this._ttl = v;
    this.#_setTimeout();
  }
}
