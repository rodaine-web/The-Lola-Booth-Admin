import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from '../api/client.js';
GlobalWorkerOptions.workerSrc = workerUrl;

export default function DocumentPreview({ path, title = 'Document preview' }) {
  const [document,setDocument]=useState(null),[error,setError]=useState(''),[zoom,setZoom]=useState(1);
  useEffect(()=>{let disposed=false,task;setDocument(null);setError('');
    api.blob(path).then(b=>b.arrayBuffer()).then(data=>{if(disposed)return;task=getDocument({data});return task.promise;}).then(doc=>{if(doc&&!disposed)setDocument(doc);}).catch(e=>{if(!disposed)setError(e.message);});
    return ()=>{disposed=true;task?.destroy();};
  },[path]);
  return <section className="pdf-preview" aria-label={title}><div className="pdf-preview-toolbar"><strong>{title}</strong><span>{document?`${document.numPages} page${document.numPages===1?'':'s'}`:'Loading…'}</span><button type="button" onClick={()=>setZoom(1)}>Fit to width</button><button type="button" aria-label="Zoom out" disabled={zoom<=0.5} onClick={()=>setZoom(z=>Math.max(.5,z-.25))}>−</button><output>{Math.round(zoom*100)}%</output><button type="button" aria-label="Zoom in" disabled={zoom>=2} onClick={()=>setZoom(z=>Math.min(2,z+.25))}>+</button></div>
  {error?<div role="alert" className="toast error">{error}</div>:<div className="pdf-preview-scroll">{document?Array.from({length:document.numPages},(_,i)=><PdfPage key={i} document={document} number={i+1} zoom={zoom}/>):<p role="status">Loading document preview…</p>}</div>}</section>;
}
function PdfPage({document,number,zoom}) {
  const frame=useRef(null),canvas=useRef(null);const [width,setWidth]=useState(0),[error,setError]=useState('');
  useEffect(()=>{const observer=new ResizeObserver(([entry])=>setWidth(entry.contentRect.width));observer.observe(frame.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(!width)return;let cancelled=false,render;
    document.getPage(number).then(page=>{if(cancelled)return;const original=page.getViewport({scale:1});const scale=Math.min(width,850)/original.width*zoom;const viewport=page.getViewport({scale});const ratio=Math.min(window.devicePixelRatio||1,2);const c=canvas.current;c.width=Math.ceil(viewport.width*ratio);c.height=Math.ceil(viewport.height*ratio);c.style.width=viewport.width+'px';c.style.height=viewport.height+'px';render=page.render({canvasContext:c.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0]});return render.promise;}).catch(e=>{if(!cancelled&&e.name!=='RenderingCancelledException')setError(e.message);});
    return()=>{cancelled=true;render?.cancel();};
  },[document,number,width,zoom]);
  return <div className="pdf-page-frame" ref={frame}>{error?<p role="alert">{error}</p>:<canvas ref={canvas} role="img" aria-label={`Page ${number}`}/>}</div>;
}
