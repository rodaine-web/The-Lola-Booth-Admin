import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { azureBlobStorage } from "./azure-blob-storage.js";

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
    if (typeof storageKey !== "string" || storageKey.includes("..") || path.isAbsolute(storageKey) || storageKey.includes("\\")) throw new Error("Invalid local storage key.");
    return fs.readFile(path.join(this.root, storageKey));
  }

  async putAt({ buffer, storageKey }) {
    if (!/^website-import\/[a-f0-9]{64}\/[a-zA-Z0-9_.-]+$/.test(storageKey)) throw new Error("Invalid content-addressed media key.");
    const target = path.join(this.root, storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
    return { storageProvider: "LOCAL", storageKey };
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

export class AzureDocumentStorageProvider {
  constructor(config = process.env, dependencies = {}) {
    this.blob = azureBlobStorage(config, "documents", dependencies);
  }
  async put({ buffer, filename, mimeType }) {
    const safeName = path.basename(filename || "document").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-160);
    const key = this.blob.prefix + randomUUID() + "-" + safeName;
    await this.blob.put(key, buffer, mimeType);
    return { storageProvider: "AZURE", storageKey: "azure/" + key };
  }
  async putAt({ buffer, storageKey, mimeType }) {
    if (!/^website-import\/[a-f0-9]{64}\/[a-zA-Z0-9_.-]+$/.test(storageKey)) throw new Error("Invalid content-addressed media key.");
    const key = this.blob.prefix + storageKey;
    try { await this.blob.put(key, buffer, mimeType); }
    catch (error) {
      // Existing content-addressed objects may be reused only after byte verification.
      if (error.statusCode !== 412 || !Buffer.from(await this.blob.get(key)).equals(buffer)) throw error;
    }
    return { storageProvider: "AZURE", storageKey: "azure/" + key };
  }
  get(key) {
    if (!key.startsWith("azure/")) throw new Error("Invalid Azure document key.");
    return this.blob.get(key.slice(6));
  }
}

export function getStorageProvider() {
  const local = new LocalStorageProvider();
  if (env.storageProvider === "azure") {
    const azure = new AzureDocumentStorageProvider();
    // Old records retain their local keys; enabling Azure changes new writes only.
    return { put: (value) => azure.put(value), putAt: (value) => azure.putAt(value),
      get: (key) => key.startsWith("azure/") ? azure.get(key) : local.get(key) };
  }
  if (env.storageProvider === "s3") return new S3CompatibleStorageProvider();
  if (env.storageProvider !== "local") throw new Error("Unsupported storage provider.");
  return { put: (value) => local.put(value), putAt: (value) => local.putAt(value),
    get: (key) => key.startsWith("azure/") ? new AzureDocumentStorageProvider().get(key) : local.get(key) };
}
