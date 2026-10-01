import { BlobServiceClient } from "@azure/storage-blob";
import { ClientSecretCredential } from "@azure/identity";
import { createHash } from "node:crypto";

export function azureStorageSettings(config = process.env, purpose = "documents") {
  const environment = config.APP_ENV || config.NODE_ENV;
  if (!["staging", "production", "test", "development"].includes(environment) || config.AZURE_STORAGE_ENV !== environment)
    throw new Error("Azure storage environment binding is missing or mismatched.");
  if (!["documents", "gallery"].includes(purpose)) throw new Error("Invalid storage purpose.");
  const container = config[purpose === "gallery" ? "GALLERY_AZURE_CONTAINER" : "AZURE_DOCUMENTS_CONTAINER"];
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/.test(container || "") || container.includes("--"))
    throw new Error("A valid private Azure container is required.");
  if ((environment === "staging" && !container.endsWith("-staging")) || (environment === "production" && container.endsWith("-staging")))
    throw new Error("Azure container does not belong to this environment.");
  const url = new URL(config.AZURE_STORAGE_ACCOUNT_URL || "https://invalid.invalid");
  if (url.protocol !== "https:" || !/^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Azure storage requires an HTTPS Azure Blob account endpoint without credentials.");
  for (const key of ["AZURE_STORAGE_TENANT_ID", "AZURE_STORAGE_CLIENT_ID", "AZURE_STORAGE_CLIENT_SECRET"])
    if (!config[key] || config[key] !== config[key].trim()) throw new Error(`${key} is required without surrounding whitespace.`);
  return { environment, container, endpoint: url.origin, prefix: `${environment}/${purpose === "gallery" ? "private-gallery" : "documents"}/` };
}

// Only backend credentials are used. Delivery stays behind LOLA's existing
// authorization routes; no account key, SAS, or public Blob URL is returned.
export function azureBlobStorage(config = process.env, purpose = "documents", dependencies = {}) {
  const settings = azureStorageSettings(config, purpose);
  const service = dependencies.service || new BlobServiceClient(settings.endpoint,
    new ClientSecretCredential(config.AZURE_STORAGE_TENANT_ID, config.AZURE_STORAGE_CLIENT_ID, config.AZURE_STORAGE_CLIENT_SECRET),
    { retryOptions: { maxTries: 3, tryTimeoutInMs: 15000 } });
  const container = service.getContainerClient(settings.container);
  function valid(key) {
    if (typeof key !== "string" || !key.startsWith(settings.prefix) || key.length > 1024 || key.includes("..") || !/^[-a-zA-Z0-9/_.]+$/.test(key))
      throw new Error("Invalid or cross-environment Azure object key.");
    return key;
  }
  async function check() {
    const properties = await container.getProperties();
    if (properties.blobPublicAccess) throw new Error("Azure container must deny anonymous access.");
    return { provider: "azure", environment: settings.environment, privateDelivery: true, container: settings.container };
  }
  return {
    provider: "azure", prefix: settings.prefix, check,
    async put(key, buffer, mime = "application/octet-stream") {
      valid(key);
      await check();
      await container.getBlockBlobClient(key).uploadData(buffer, {
        conditions: { ifNoneMatch: "*" },
        blobHTTPHeaders: { blobContentType: mime, blobContentMD5: createHash("md5").update(buffer).digest() },
        metadata: { environment: settings.environment, sha256: createHash("sha256").update(buffer).digest("hex") },
      });
      return key;
    },
    async get(key) { valid(key); await check(); return container.getBlobClient(key).downloadToBuffer(); },
    async stream(key) { valid(key); await check(); return (await container.getBlobClient(key).download()).readableStreamBody; },
  };
}
