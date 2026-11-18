import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

/** Admin-only, event-scoped preview. Never exposes a storage key or public approval token. */
export default function Client360CreativeArtworkPreview({ eventId, proof }) {
  const [versions, setVersions] = useState([]);
  const [version, setVersion] = useState('');
  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setVersions([]);
    setVersion('');
    setError('');
    if (!eventId || !proof?.id) return () => { active = false; };
    setLoading(true);
    api.get('/creative-approvals/' + encodeURIComponent(proof.id))
      .then(result => {
        if (!active) return;
        if (result?.approval?.event_id !== eventId) throw new Error('This design is not linked to the selected event.');
        const items = Array.isArray(result.revisions) ? result.revisions : [];
        const current = result.approval;
        const available = items.length ? items : [{
          id: 'current', version: current.version,
          proof_document_id: current.proof_document_id,
          proof_url: current.proof_url,
          status: current.status,
        }];
        setVersions(available);
        setVersion(String(available[0]?.version ?? ''));
      })
      .catch(err => { if (active) setError(err.message || 'Could not load design versions.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventId, proof?.id]);

  const chosen = versions.find(item => String(item.version) === version);
  useEffect(() => {
    let active = true;
    let objectUrl = null;
    setAsset(null);
    if (!eventId || !chosen) return () => { active = false; };
    const fileId = chosen.proof_document_id;
    if (!fileId) return () => { active = false; };
    setLoading(true);
    setError('');
    api.blob('/events/' + encodeURIComponent(eventId) + '/planning/assets/' + encodeURIComponent(fileId))
      .then(blob => {
        if (!active) return;
        const mime = String(blob.type || '').split(';')[0].toLowerCase();
        const kind = mime === 'application/pdf' ? 'pdf' :
          ['image/png', 'image/jpeg', 'image/webp'].includes(mime) ? 'image' : 'unknown';
        if (kind === 'unknown') {
          setError('Preview is not available for this file type. You can download the proof instead.');
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setAsset({ url: objectUrl, kind });
      })
      .catch(err => { if (active) setError(err.message || 'Unable to load the artwork preview.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [eventId, chosen?.id, chosen?.version, chosen?.proof_document_id]);

  if (!proof) return null;
  const externalUrl = typeof chosen?.proof_url === 'string' && /^https:\/\//i.test(chosen.proof_url)
    ? chosen.proof_url : null;
  const fileId = chosen?.proof_document_id;
  const download = () => {
    if (!fileId) return;
    api.download('/events/' + encodeURIComponent(eventId) + '/planning/assets/' + encodeURIComponent(fileId),
      'LOLA-design-v' + String(chosen.version || 'latest')).catch(err => setError(err.message));
  };
  return (
    <section className="c360-creative-artwork" aria-label="Selected creative design preview">
      <div className="c360-creative-artwork-head">
        <div><strong>Design preview</strong><small>Saved artwork · {proof.metadata?.design_name || proof.approval_type || 'Creative item'}</small></div>
        {versions.length > 1 && <label>Version
          <select aria-label="Preview design version" value={version} onChange={e => setVersion(e.target.value)}>
            {versions.map(item => <option key={item.id || item.version} value={String(item.version)}>Version {item.version} · {(item.status || 'Draft').replaceAll('_', ' ')}</option>)}
          </select>
        </label>}
      </div>
      {error && <p role="alert" className="toast error">{error}</p>}
      {loading ? <p role="status">Loading saved artwork…</p> : asset?.kind === 'image' ?
        <img className="c360-creative-artwork-image" src={asset.url} alt={'Saved creative proof version ' + version} /> :
        asset?.kind === 'pdf' ? <iframe className="c360-creative-artwork-pdf" src={asset.url + '#toolbar=0'} title={'Creative PDF proof version ' + version} /> :
        externalUrl ? <p>This design uses an external HTTPS proof link. Open it in a new tab to review the artwork.</p> :
        !error ? <p>No saved artwork is attached to this version.</p> : null}
      <div className="button-row">
        {fileId && <button type="button" onClick={download}>Download selected version</button>}
        {externalUrl && <a className="inline-link" href={externalUrl} target="_blank" rel="noopener noreferrer">Open external proof</a>}
      </div>
    </section>
  );
}
