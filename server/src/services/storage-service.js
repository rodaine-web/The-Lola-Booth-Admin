import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";

export class LocalStorageProvider {
  constructor(root = env.localStorageRoot) {
    this.root = root;
  }

  async put({ buffer, filename }) {
    const storageKey = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${filename}`;
    const target = path.join(this.root, storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
    return { storageProvider: "LOCAL", storageKey };
  }

  async get(storageKey) {
    return fs.readFile(path.join(this.root, storageKey));
  }
}

export class S3CompatibleStorageProvider {
  async put() {
    throw new Error("S3-compatible storage is configured as an integration foundation but is not active yet.");
  }

  async get() {
    throw new Error("S3-compatible storage is configured as an integration foundation but is not active yet.");
  }
}

export function getStorageProvider() {
  if (env.storageProvider === "s3") return new S3CompatibleStorageProvider();
  return new LocalStorageProvider();
}
