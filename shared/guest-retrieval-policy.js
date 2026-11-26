export function maskRetrievalEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!local || !domain) return null;
  const parts = domain.split("."),
    tld = parts.length > 1 ? parts.at(-1) : "";
  return `${local[0]}••••@${domain[0]}••••${tld ? "." + tld : ""}`;
}
export const GUEST_RETRIEVAL_MESSAGE =
  "If these details match an eligible photo collection, we’ll email a secure link. Check your inbox and spam folder, or use your original photo link or contact support.";
