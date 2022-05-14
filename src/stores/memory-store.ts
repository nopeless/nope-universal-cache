import { GenericStore } from "../types.js";

class MemoryStore<T> implements GenericStore<T> {
  protected entries = new Map<string, T>();
  constructor() {
    // Constructor
  }
  async create(key: string, value: T): Promise<T> {
    this.entries.set(key, value);
    return value;
  }
  async read(key: string): Promise<T | undefined> {
    return this.entries.get(key);
  }
  async update(key: string, value: T): Promise<T> {
    this.entries.set(key, value);
    return value;
  }
  async delete(key: string): Promise<boolean> {
    return this.entries.delete(key);
  }
  async clear(): Promise<number> {
    const size = this.entries.size;
    this.entries.clear();
    return size;
  }
}

export { MemoryStore };
