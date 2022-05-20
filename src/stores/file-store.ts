import fs from "fs";
import path from "path";
import { createHash } from "crypto";

import { GenericStore } from "../types.js";

const fsp = fs.promises;

type writeFileData = Parameters<typeof fsp[`writeFile`]>[1];

type converters<T> = {
  serialize: (v: T) => Promise<writeFileData> | writeFileData;
  deserialize: (v: Buffer) => Promise<T> | T;
};

function sha256(str: string): string {
  return createHash(`sha256`).update(str).digest(`hex`);
}

class FileStore<T> implements GenericStore<T> {
  public readonly serialize: converters<T>[`serialize`];
  public readonly deserialize: converters<T>[`deserialize`];
  public readonly path: string;
  constructor(
    opts: {
      path?: string;
      serialize?: converters<T>[`serialize`];
      deserialize?: converters<T>[`deserialize`];
    } = {}
  ) {
    // Constructor
    this.path = opts?.path ?? `./.cache`;
    if (`serialize` in opts !== `deserialize` in opts) {
      throw new Error(`serialize and deserialize must be specified together`);
    }
    this.serialize = opts?.serialize ?? JSON.stringify;
    this.deserialize =
      opts?.deserialize ?? ((b: Buffer) => JSON.parse(b.toString()));
  }
  async create(key: string, value: T) {
    const data = await this.serialize(value);
    const hash = sha256(key);
    const file = path.join(this.path, hash);
    await fsp.writeFile(file, data);
    return value;
  }
  async read(key: string) {
    const hash = sha256(key);
    const file = path.join(this.path, hash);
    const data = await fsp.readFile(file).catch((e) => {
      if (e.code === `ENOENT`) return undefined;
      throw e;
    });
    return data && this.deserialize(data);
  }
  async update(key: string, value: T) {
    const data = await this.serialize(value);
    const hash = sha256(key);
    const file = path.join(this.path, hash);
    await fsp.writeFile(file, data);
    return value;
  }
  async delete(key: string) {
    const hash = sha256(key);
    const file = path.join(this.path, hash);
    await fsp.unlink(file);
    return true;
  }
  async clear() {
    const files = await fsp.readdir(this.path);
    for (const file of files) {
      await fsp.unlink(path.join(this.path, file));
    }
    return files.length;
  }
}

export { FileStore };
