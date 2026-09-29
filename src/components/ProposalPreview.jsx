import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export default function ProposalPreview({ token }) {
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setHtml(null);
    setError(false);
    fetch(`${API_URL}/public/proposals/${token}/preview`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error("Preview unavailable");
        return response.text();
      })
      .then(setHtml)
      .catch(error => { if (error.name !== "AbortError") setError(true); });
    return () => controller.abort();
  }, [token]);

  if (error) return <p role="alert">The preview could not load. You can still download the proposal PDF below.</p>;
  if (html === null) return <p role="status">Loading proposal preview…</p>;
  // Render the generated document in an opaque, script-free frame. Directly
  // framing the API is blocked by its cross-origin frame protections.
  return <iframe className="document-preview" title="Proposal preview" sandbox="" srcDoc={html} />;
}
