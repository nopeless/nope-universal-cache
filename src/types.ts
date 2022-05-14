interface GenericStore<T> {
  /**
   * Create a new entry in the store.
   */
  create(key: string, value: T): Promise<T>;
  /**
   * Read a value given a key
   */
  read(key: string): Promise<T | undefined>;
  /**
   * Update a given index to a new value
   */
  update(key: string, value: T): Promise<T>;
  /**
   * return whether the object had already existed
   */
  delete(key: string): Promise<boolean>;
  /**
   * Number of entries deleted
   */
  clear(): Promise<number>;
}

type TtlOption = string | number;

export { GenericStore, TtlOption };
