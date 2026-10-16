import {useEffect,useState} from 'react';
import {api} from '../api/client.js';
import {useAuth} from '../context/AuthContext.jsx';
import {formatTimestamp} from '../utils/display.js';
export default function DropboxGalleryImport({album,onImported}) {
  const {can}=useAuth(),[data,setData]=useState(null),[folder,setFolder]=useState(''),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const permitted=can('read:integrations'),write=can('write:integrations')&&can('write:operations'),published=Boolean(album.published_at),base=`/gallery-admin/albums/${album.id}/dropbox`;
  useEffect(()=>{let alive=true;if(!permitted)return;api.get(base).then(result=>{if(alive){setData(result);setFolder(result.source?.folder_path||'');setEnabled(Boolean(result.source?.enabled));}}).catch(error=>{if(alive)setMessage(error.message);});return()=>{alive=false;};},[base,permitted]);
  async function run(action,notice) {if(busy)return;setBusy(true);setMessage('');try{const result=await action();const status=await api.get(base);setData(status);setEnabled(Boolean(status.source?.enabled));setFolder(status.source?.folder_path||'');setMessage(typeof notice==='function'?notice(result):notice);await onImported();}catch(error){setMessage(error.message);}finally{setBusy(false);}}
  if(!permitted)return null;
  return <section className="panel"><h2>Import from Dropbox</h2><p>Use the event’s delivery folder in info@thelolabooth.com. Subfolders are excluded. Imports keep original filenames and never publish the gallery or send guest messages.</p>
    {!data?.configured&&<p role="status">Dropbox is not connected yet. Your administrator must finish the secure account connection.</p>}
    {write&&<div className="button-row"><button disabled={busy||!data?.connection?.appConfigured} onClick={()=>run(async()=>{const result=await api.post(base+'/connect',{});window.location.assign(result.url);},'Opening Dropbox…')}>{data?.configured?'Reconnect Dropbox':'Connect Dropbox'}</button>{data?.configured&&<button disabled={busy} onClick={()=>run(()=>api.post('/gallery-admin/dropbox/disconnect',{}),'Dropbox disconnected. All folder imports are paused.')}>Disconnect Dropbox</button>}</div>}
    {published&&<p>This gallery has been published. Dropbox imports are stopped to protect the delivered collection.</p>}
    {data?.source&&<dl><dt>Last import</dt><dd>{formatTimestamp(data.source.last_sync_at)}</dd><dt>Imported file revisions</dt><dd>{data.source.imported}</dd><dt>Last issue</dt><dd>{data.source.last_error_code||'None'}</dd></dl>}
    {write&&<><form onSubmit={event=>{event.preventDefault();run(()=>api.post(base,{folderPath:folder,enabled}),'Dropbox folder saved.');}}><label>Event delivery folder <span aria-label="required">*</span><input required value={folder} maxLength={1000} disabled={busy||published||!data?.configured} onChange={event=>setFolder(event.target.value)} placeholder="/Fiesta/Event delivery folder"/></label><label className="checkbox-field"><input type="checkbox" checked={enabled} disabled={busy||published||!data?.configured} onChange={event=>setEnabled(event.target.checked)}/>Import new files automatically before publication</label><button disabled={busy||published||!data?.configured}>Save Dropbox folder</button></form>
    <div className="button-row"><button disabled={busy||published||!data?.active||!data?.source} onClick={()=>run(()=>api.post(base+'/sync',{}),result=>`${result.imported} imported; ${result.replayed} already imported. ${result.hasMore?'More files will be available on the next import.':''} No messages sent.`)}>Import now</button><button disabled={busy||!data?.source} onClick={()=>run(()=>api.post(base+'/pause',{}),'Dropbox imports paused.')}>Pause imports</button></div></>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
