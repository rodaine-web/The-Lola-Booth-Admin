import {useEffect} from 'react';
export function useDialogFocus(open,onClose){
 useEffect(()=>{
  if(!open)return;
  const previous=document.activeElement,dialog=document.querySelector('[role="dialog"][aria-modal="true"]');if(!dialog)return;
  const selector='button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]';
  const items=()=>[...dialog.querySelectorAll(selector)].filter(el=>el.getClientRects().length);
  items()[0]?.focus();
  function keydown(e){if(e.key==='Escape'){e.preventDefault();onClose();}if(e.key==='Tab'){const focusable=items(),first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}
  document.addEventListener('keydown',keydown);return()=>{document.removeEventListener('keydown',keydown);requestAnimationFrame(()=>{if(previous?.isConnected&&previous!==document.body)previous.focus();else document.querySelector('[data-dialog-trigger="user-create"]')?.focus();});};
 },[open]);
}
