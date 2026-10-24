import ProposalAgreement from "../components/ProposalAgreement.jsx";
import {AssetImage} from "../components/ProposalVisualEditor.jsx";
import { documentAccessState } from "../../shared/document-access.js";
import AsyncState from "../components/AsyncState.jsx";
import { formatDateOnly, formatMoney, formatTimestamp } from "../utils/display.js";
import { Archive, ArrowLeft, Copy, Download, FileText, Mail, ReceiptText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import AdminProposalPreview from "../components/AdminProposalPreview.jsx";
import { api } from "../api/client.js";

export default function ProposalDetail({reviewMode=false}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [proposal, setProposal] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy,setBusy]=useState(false);
  const [copies,setCopies]=useState(['']);
  const [reviewed,setReviewed]=useState(false);
  const [emailBody,setEmailBody]=useState('');
  const emailDraftKey=useRef('');
  const requestId=useRef(crypto.randomUUID());
  useEffect(()=>{setReviewed(false);requestId.current=crypto.randomUUID();},[id,proposal?.review_version_id,reviewMode]);

  useEffect(() => { load(); }, [id]);

  async function load() {
    try {
      const data = await api.get(`/proposals/${id}`);
      setProposal(data);
      const draftKey=`${id}:${data.review_version_id}`;
      if(emailDraftKey.current!==draftKey){setEmailBody(data.email_preview?.editableBody||'');emailDraftKey.current=draftKey;}
    } catch (err) {
      setError(err.message);
    }
  }

  async function action(fn, message) {
    if(busy)return;setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {setBusy(false);}
  }

  async function sendReviewed(retry=false){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{
      const previous=retry?proposal.latest_delivery:null;
      const result=await api.post(`/proposals/${id}/send`,{requestId:previous?.request_id||requestId.current,versionId:previous?.version_id||proposal.review_version_id,recipients:previous?previous.recipients.map(row=>row.email):[proposal.client_email,...copies.map(value=>value.trim()).filter(Boolean)],...(!previous?{emailBody}: {})});
      setNotice(result.status==='COMPLETE'?'All proposal emails were accepted by the provider.':result.status==='UNKNOWN'?'A delivery outcome is uncertain. Operator review is required before resending.':result.status==='PROCESSING'?'Delivery is already processing. Refresh its status; do not send again.':'Some emails were not accepted. Review the recipient results and retry only failed recipients.');
      await load();
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }

  async function createInvoiceFromProposal() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const invoice = await api.post(`/proposals/${id}/create-invoice`, { depositOnly: true });
      navigate(`/finance/invoices/${invoice.id}`);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  if (error && !proposal) return <main className="page record-detail-redesign"><AsyncState error={error} noun="proposal" onRetry={()=>{setError("");load();}}/></main>;
  if (!proposal) return <main className="page"><div className="empty-state">Loading proposal...</div></main>;

  const accessAvailable = documentAccessState(proposal) === "AVAILABLE";
  return (
    <main className="page">
      <div className="detail-back"><Link to="/sales/proposals"><ArrowLeft size={16} />Back to proposals</Link></div>
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">{proposal.proposal_number}</p>
          <h1>{reviewMode?'Final proposal review':proposal.proposal_title || proposal.content?.scenario?.title || proposal.event_name || proposal.client_name || "Proposal"}</h1>
          <p className="lede">{proposal.event_name || "No event"} · {proposal.status} · Total {formatMoney(proposal.total || 0)}</p>
        </div>
        {!reviewMode&&<div className="detail-actions">
          {can("write:sales") && ["DRAFT", "READY", "SENT", "VIEWED", "EXPIRED"].includes(proposal.status) && !proposal.linked_invoice_id && proposal.proposal_source !== "UPLOADED" && <Link className="primary-action" to={`/sales/proposals/${id}/edit`}>Edit proposal</Link>}
          {accessAvailable && proposal.public_url && <a href={proposal.public_url} target="_blank" rel="noreferrer">Public proposal</a>}
          <button disabled={busy || !accessAvailable} className="primary-action" onClick={() => navigate(`/sales/proposals/${id}/review`)}><Mail size={16} />Review & Send</button>
          <button disabled={busy} onClick={() => action(() => api.download(`/proposals/${id}/pdf`, `${proposal.proposal_number}.pdf`), "PDF generated.")}><Download size={16} />PDF</button>
          <button disabled={busy} onClick={() => action(() => api.download(`/proposals/${id}/docx`, `${proposal.proposal_number}.docx`), "DOCX generated.")}><FileText size={16} />DOCX</button>
          <button disabled={busy} onClick={() => action(() => api.post(`/proposals/${id}/duplicate`, {}), "Proposal duplicated.")}><Copy size={16} />Duplicate</button>
          <button disabled={busy} onClick={() => action(() => api.post(`/proposals/${id}/archive`, {}), "Proposal archived.")}><Archive size={16} />Archive</button>
          {proposal.linked_invoice_id ? <Link className="primary-action" to={`/finance/invoices/${proposal.linked_invoice_id}`}><ReceiptText size={16} />Open Invoice</Link> : <button className="primary-action" disabled={busy||proposal.status !== "ACCEPTED"} onClick={createInvoiceFromProposal}><ReceiptText size={16} />Create Invoice</button>}
        </div>}
      </div>
      {(error || notice) && <div role={error?"alert":"status"} className={error ? "toast error" : "toast"}>{error || notice}</div>}
      {proposal.has_unsent_revision&&<p role="status">Unsent revision saved. The client still sees the previously sent proposal until you send this update.</p>}
      {reviewMode&&<form className="panel" aria-label="Final proposal review" onSubmit={event=>{event.preventDefault();if(reviewed)sendReviewed();}}>
        <Link to={`/sales/proposals/${id}`}>Back to proposal</Link>
        <h2>Review recipients and email</h2>
        <p>Nothing is sent until you confirm below. The primary client receives the acceptance link; additional recipients receive information-only copies.</p>
        <label>Primary client email<input aria-label="Primary client email" type="email" readOnly value={proposal.client_email||''}/></label>
        {copies.map((value,index)=><label key={index}>Additional recipient {index+1}<input aria-label={`Additional recipient ${index+1}`} type="email" maxLength={254} disabled={busy} value={value} onChange={event=>{setCopies(rows=>rows.map((row,i)=>i===index?event.target.value:row));setReviewed(false);requestId.current=crypto.randomUUID();}}/></label>)}
        <button type="button" disabled={busy||copies.length>=9} onClick={()=>setCopies(rows=>[...rows,''])}>Add another recipient</button>
        <h3>Email subject</h3><p>{proposal.email_preview?.subject}</p><label>Email message<textarea aria-label="Email message" rows={12} maxLength={12000} required disabled={busy} value={emailBody} onChange={event=>{setEmailBody(event.target.value);setReviewed(false);requestId.current=crypto.randomUUID();}}/></label><p>The secure proposal link and recipient access notice are added automatically. This message changes the email only; proposal content and pricing stay as reviewed.</p>
        <h3>Proposal preview</h3><AdminProposalPreview key={proposal.review_version_id} id={id}/>
        <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={event=>setReviewed(event.target.checked)}/>I have reviewed the proposal, pricing and recipient addresses.</label>
        <button className="primary-action" disabled={busy||!reviewed||!emailBody.trim()||!can('write:sales')||!['DRAFT','READY','SENT','VIEWED','EXPIRED'].includes(proposal.status)||Boolean(proposal.linked_invoice_id)}>{busy?'Sending…':proposal.has_unsent_revision?'Send Updated Proposal':'Send Proposal'}</button>
      </form>}
      {proposal.latest_delivery&&<section className="panel" aria-label="Proposal delivery results"><h2>Email delivery results</h2><p>Provider acceptance is not proof of inbox delivery.</p><ul>{proposal.latest_delivery.recipients.map(row=><li key={row.email}>{row.email} · {row.is_primary?'Primary client':'Information-only copy'} · {row.status==='ACCEPTED'?'Accepted by provider':row.status}{row.error_code?` · ${row.error_code}`:''}</li>)}</ul>{['PARTIAL','FAILED'].includes(proposal.latest_delivery.status)&&<button disabled={busy||!can('write:sales')} onClick={()=>sendReviewed(true)}>Retry failed recipients</button>}{['UNKNOWN','PROCESSING'].includes(proposal.latest_delivery.status)&&<p>Delivery is processing or uncertain. Refresh or ask Admin to review the provider status before any resend.</p>}</section>}
      {proposal.status === "ACCEPTED" && !proposal.linked_invoice_id && <section className="panel"><h2>Proposal accepted</h2><p><strong>Next step:</strong> create one invoice for this proposal. The invoice tracks the full proposal total, requests the configured deposit first, and then continues with the remaining balance.</p><div className="button-row"><button className="primary-action" disabled={busy} onClick={createInvoiceFromProposal}><ReceiptText size={16} />Create Invoice</button></div></section>}
      {proposal.linked_invoice_id && <section className="panel"><h2>Invoice created</h2><p>{proposal.linked_invoice_number || "The linked invoice"} · {proposal.linked_invoice_status || "Current"}. Booking retainer fee and remaining balance are managed on this single invoice.</p><Link className="primary-action" to={`/finance/invoices/${proposal.linked_invoice_id}`}><ReceiptText size={16} />Open Invoice</Link></section>}
      {!accessAvailable && <section className="panel"><p role="status">Public access not available.</p>{can("write:sales") && <button disabled={busy} onClick={()=>action(()=>api.post(`/proposals/${id}/ensure-access`,{}),"Secure access generated.")}>Generate Secure Access</button>}</section>}
      {!reviewMode&&<ProposalAgreement proposal={proposal} />}
      <section className="detail-summary">
        <Metric label="Valid Through" value={proposal.valid_through ? formatDateOnly(proposal.valid_through) : "Unset"} />
        <Metric label="Sent" value={proposal.sent_at ? new Date(proposal.sent_at).toLocaleDateString() : "Not sent"} />
        <Metric label="Views" value={proposal.view_count || 0} />
        <Metric label="Accepted By" value={proposal.accepted_by_name || "Not accepted"} />
      </section>
      <section className="panel"><h2>Version history</h2>{proposal.versions?.length ? <ul>{proposal.versions.map(version => <li key={version.id}>Version {version.version_number} · {new Date(version.created_at).toLocaleString()}</li>)}</ul> : <p>No saved versions.</p>}</section>
      <section className="panel">
        <div className="table-heading">
          <div>
            <h2>HTML Proposal Preview</h2>
            <p className="note-text">This is the client-facing proposal view. Review it here first, then download the PDF when you are satisfied.</p>
          </div>
          <button disabled={busy} onClick={() => action(() => api.download(`/proposals/${id}/pdf`, `${proposal.proposal_number}.pdf`), "PDF generated.")}><Download size={16} />Download PDF</button>
        </div>
        {!!proposal.visual_sections?.length&&<section className="panel"><h2>Saved proposal photos</h2>{proposal.visual_sections.map(section=><article key={section.id}><h3>{section.title}</h3><p>{section.body}</p><div className="proposal-asset-grid">{section.media_ids.map((mediaId,index)=><figure key={mediaId}><AssetImage id={mediaId} alt={`${section.title} — photo ${index+1}`}/></figure>)}</div></article>)}</section>}
        {!reviewMode&&<AdminProposalPreview key={proposal.review_version_id} id={id} />}
      </section>
    </main>
  );
}

function Metric({ label, value }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
