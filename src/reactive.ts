type Executor<T> = (oldValue: T, newValue: T) => void;

/**
 * A simple reactivity model
 * does not emit if the value didn't change
 */
class Ref<T> {
  protected listeners: Executor<T>[] = [];

  constructor(protected _value: T) {}

  get value() {
    return this._value;
  }
  set value(newValue: T) {
    const oldValue = this._value;
    if (oldValue === newValue) return;
    this._value = newValue;
    this.listeners.forEach((listener) => {
      listener(oldValue, newValue);
    });
  }
  hook(listener: Executor<T>) {
    this.listeners.push(listener);
  }
}

function computedRef<T>(
  calculate: () => T,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dependencies: Ref<any>[]
): Ref<T> {
  const computed = new Ref<T>(calculate());
  dependencies.forEach((dep) => {
    dep.hook(() => {
      computed.value = calculate();
    });
  });
  return computed;
}

export { Ref, computedRef };
