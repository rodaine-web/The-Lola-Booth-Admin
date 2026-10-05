import { useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export default function ProposalPreview({ token }) {
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(false);
  const frameRef = useRef(null);

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

  function resizeFrame() {
    const frame = frameRef.current;
    const frameDocument = frame?.contentDocument;
    if (!frame || !frameDocument) return;
    frameDocument.querySelectorAll('a[href="#accept"]').forEach(link=>{link.onclick=event=>{event.preventDefault();document.querySelector('.public-proposal-acceptance')?.scrollIntoView({behavior:'smooth'});document.querySelector('.public-proposal-acceptance input')?.focus();};});
    frame.style.height = `${Math.max(frameDocument.documentElement?.scrollHeight || 0, frameDocument.body?.scrollHeight || 0, 760) + 8}px`;
  }

  if (error) return <p role="alert">The preview could not load. You can still download the proposal PDF below.</p>;
  if (html === null) return <p role="status">Loading proposal preview…</p>;
  return <iframe ref={frameRef} className="document-preview proposal-document-preview" title="Proposal preview" sandbox="allow-same-origin" srcDoc={html} onLoad={resizeFrame} />;
}
