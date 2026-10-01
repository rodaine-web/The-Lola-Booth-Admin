import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";

export default function AdminProposalPreview({ id }) {
  const [html,setHtml]=useState(null);
  const [error,setError]=useState("");
  const frameRef=useRef(null);

  useEffect(()=>{
    let active=true;
    setHtml(null);setError("");
    api.text(`/proposals/${id}/preview`)
      .then(value=>{if(active)setHtml(value);})
      .catch(err=>{if(active)setError(err.message||"Preview failed");});
    return()=>{active=false;};
  },[id]);

  function resizeFrame(){
    const frame=frameRef.current;
    const frameDocument=frame?.contentDocument;
    if(!frame||!frameDocument)return;
    frame.style.height=`${Math.max(frameDocument.documentElement?.scrollHeight||0,frameDocument.body?.scrollHeight||0,760)+8}px`;
  }

  if(error)return <div className="toast error" role="alert">{error}</div>;
  if(html===null)return <div className="empty-state">Loading proposal preview...</div>;
  return <iframe ref={frameRef} className="document-preview proposal-document-preview" title="Proposal preview" sandbox="allow-same-origin" srcDoc={html} onLoad={resizeFrame}/>;
}
