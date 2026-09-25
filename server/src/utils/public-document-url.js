import { env } from "../config/env.js";

// Secure document pages live in the Admin app; the marketing site has separate routes.
export function documentOrigin() {
  return (env.publicDocumentBaseUrl || env.clientOrigin || env.publicBaseUrl).replace(/\/$/, "");
}
