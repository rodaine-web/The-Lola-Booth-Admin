const DB_NAME = "lola-field-ops";
const STORE = "offline_actions";
const FILE_STORE = "offline_files";
const VERSION = 2;
export const MAX_OFFLINE_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_OFFLINE_CACHE_BYTES = 50 * 1024 * 1024;
export const MAX_OFFLINE_FILE_ATTEMPTS = 5;
export const STALE_OFFLINE_FILE_DAYS = 14;
export const ALLOWED_OFFLINE_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "local_id" });
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: "local_id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
  });
}

async function withNamedStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function queueAction(action) {
  const record = {
    local_id: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    attempt_count: 0,
    last_attempt_at: null,
    last_error: null,
    status: "PENDING",
    ...action
  };
  try {
    await withStore("readwrite", (store) => store.put(record));
  } catch {
    const rows = JSON.parse(localStorage.getItem("lola-offline-actions") || "[]");
    localStorage.setItem("lola-offline-actions", JSON.stringify([...rows, record]));
  }
  return record;
}

export async function listQueuedActions() {
  try {
    return await withStore("readonly", (store) => store.getAll());
  } catch {
    return JSON.parse(localStorage.getItem("lola-offline-actions") || "[]");
  }
}

export async function updateQueuedAction(record) {
  try {
    await withStore("readwrite", (store) => store.put(record));
  } catch {
    const rows = await listQueuedActions();
    localStorage.setItem("lola-offline-actions", JSON.stringify(rows.map((item) => item.local_id === record.local_id ? record : item)));
  }
}

export async function removeQueuedAction(localId) {
  try {
    await withStore("readwrite", (store) => store.delete(localId));
  } catch {
    const rows = await listQueuedActions();
    localStorage.setItem("lola-offline-actions", JSON.stringify(rows.filter((item) => item.local_id !== localId)));
  }
}

export async function queueOfflineFile(file, metadata = {}) {
  if (!file || file.size > MAX_OFFLINE_FILE_BYTES) throw new Error("This file is too large for offline retry.");
  if (!ALLOWED_OFFLINE_FILE_TYPES.includes(file.type)) throw new Error("This file type is not supported for offline retry.");
  const currentSize = await offlineFileCacheSize();
  if (currentSize + file.size > MAX_OFFLINE_CACHE_BYTES) throw new Error("Offline upload cache is full. Sync or clear pending uploads before adding more files.");
  const record = {
    local_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    filename: file.name,
    content_type: file.type,
    size: file.size,
    status: "PENDING",
    attempt_count: 0,
    next_attempt_at: new Date().toISOString(),
    last_error: null,
    metadata,
    blob: file
  };
  await withNamedStore(FILE_STORE, "readwrite", (store) => store.put(record));
  return { ...record, blob: undefined };
}

export async function markOfflineFileAttempt(localId, error = "") {
  const files = await listOfflineFiles();
  const record = files.find((item) => item.local_id === localId);
  if (!record) return null;
  const attemptCount = Number(record.attempt_count || 0) + 1;
  const delayMs = Math.min(30, 2 ** attemptCount) * 60000;
  const updated = {
    ...record,
    attempt_count: attemptCount,
    last_error: error,
    last_attempt_at: new Date().toISOString(),
    next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
    status: attemptCount >= MAX_OFFLINE_FILE_ATTEMPTS ? "PERMANENT_FAILURE" : "PENDING"
  };
  await withNamedStore(FILE_STORE, "readwrite", (store) => store.put(updated));
  return { ...updated, blob: undefined };
}

export async function cleanupStaleOfflineFiles(now = new Date()) {
  const cutoff = now.getTime() - STALE_OFFLINE_FILE_DAYS * 86400000;
  const files = await listOfflineFiles();
  const stale = files.filter((item) => item.status === "PERMANENT_FAILURE" && new Date(item.created_at).getTime() < cutoff);
  await Promise.all(stale.map((item) => removeOfflineFile(item.local_id)));
  return { removed: stale.length };
}

export async function listOfflineFiles() {
  try {
    return await withNamedStore(FILE_STORE, "readonly", (store) => store.getAll());
  } catch {
    return [];
  }
}

export async function removeOfflineFile(localId) {
  try {
    await withNamedStore(FILE_STORE, "readwrite", (store) => store.delete(localId));
  } catch {
    // File retry requires IndexedDB Blob support.
  }
}

export async function offlineFileCacheSize() {
  const files = await listOfflineFiles();
  return files.reduce((total, item) => total + Number(item.size || 0), 0);
}

export async function clearOfflineCache() {
  localStorage.removeItem("lola-offline-actions");
  Object.keys(localStorage).filter((key) => key.startsWith("lola-attendant-")).forEach((key) => localStorage.removeItem(key));
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, FILE_STORE], "readwrite");
    tx.objectStore(STORE).clear();
    tx.objectStore(FILE_STORE).clear();
  } catch {
    // localStorage cleanup above is enough for browsers without IndexedDB.
  }
}
