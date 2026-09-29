import { env } from "../config/env.js";

// Customer document routes are served on the environment-specific public website.
export function documentOrigin() {
  return (env.publicDocumentBaseUrl || env.clientOrigin || env.publicBaseUrl).replace(/\/$/, "");
}
