const API_URL = import.meta.env?.VITE_API_URL || "/api";

let accessToken = localStorage.getItem("lola_access_token");
let refreshToken = localStorage.getItem("lola_refresh_token");

export function setTokens(tokens) {
  accessToken = tokens?.accessToken || null;
  refreshToken = tokens?.refreshToken || refreshToken || null;
  if (accessToken) localStorage.setItem("lola_access_token", accessToken);
  if (refreshToken) localStorage.setItem("lola_refresh_token", refreshToken);
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem("lola_access_token");
  localStorage.removeItem("lola_refresh_token");
}

async function request(path, options = {}, retry = true, responseType = "json") {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers
    }
  });

  if (response.status === 401 && retry && refreshToken) {
    const refreshed = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    if (refreshed.ok) {
      setTokens(await refreshed.json());
      return request(path, options, false, responseType);
    }
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error?.message || (response.status === 404 ? "Record not found." : response.status === 403 ? "You do not have access to this area." : "The request could not be completed."));
    error.status = response.status; error.code = payload.error?.code; error.requestId = payload.error?.requestId;
    if (response.status >= 500 && error.requestId) error.message += ` Reference: ${error.requestId}`;
    throw error;
  }

  if (response.status === 204) return null;
  return responseType === "blob" ? response.blob() : response.json();
}

async function download(path, filename, retry = true) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  });

  if (response.status === 401 && retry && refreshToken) {
    const refreshed = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    if (refreshed.ok) {
      setTokens(await refreshed.json());
      return download(path, filename, false);
    }
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message || "Download failed");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadPost(path, body, filename, retry = true) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body || {})
  });

  if (response.status === 401 && retry && refreshToken) {
    const refreshed = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    if (refreshed.ok) {
      setTokens(await refreshed.json());
      return downloadPost(path, body, filename, false);
    }
  }

  if (!response.ok) throw new Error("Download failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function text(path, retry = true) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  });
  if (response.status === 401 && retry && refreshToken) {
    const refreshed = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    if (refreshed.ok) {
      setTokens(await refreshed.json());
      return text(path, false);
    }
  }
  if (!response.ok) throw new Error("Preview failed");
  return response.text();
}

// Coalesce identical concurrent mutations from rapid UI actions. This protects
// one browser session; server transactions still enforce business invariants.
const pendingMutations=new Map();
function mutate(method,path,body){
 const encoded=JSON.stringify(body),key=JSON.stringify([accessToken,method,path,encoded]);
 if(pendingMutations.has(key))return pendingMutations.get(key);
 const promise=request(path,{method,body:encoded}).finally(()=>pendingMutations.delete(key));
 pendingMutations.set(key,promise);return promise;
}

export const api = {
  login: (credentials) => request("/auth/login", { method: "POST", body: JSON.stringify(credentials) }, false),
  setupPassword: (payload) => request("/auth/setup-password", { method: "POST", body: JSON.stringify(payload) }, false),
  logout: () => request("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }, false),
  me: () => request("/auth/me"),
  get: (path) => request(path),
  blob: (path) => request(path, {}, true, "blob"),
  post: (path, body) => mutate("POST",path,body),
  patch: (path, body) => mutate("PATCH",path,body),
  delete: (path) => request(path, { method: "DELETE" }),
  download,
  downloadPost,
  text
};
