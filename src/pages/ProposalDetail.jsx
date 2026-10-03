import {AssetImage} from "../components/ProposalVisualEditor.jsx";
import { documentAccessState } from "../../shared/document-access.js";
import AsyncState from "../components/AsyncState.jsx";
import { formatDateOnly, formatMoney, formatTimestamp } from "../utils/display.js";
import { Archive, ArrowLeft, Copy, Download, FileText, Mail, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import AdminProposalPreview from "../components/AdminProposalPreview.jsx";
import { api } from "../api/client.js";

export default function ProposalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [proposal, setProposal] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy,setBusy]=useState(false);
  const [sendOpen,setSendOpen]=useState(false);
  const [recipient,setRecipient]=useState("");

  useEffect(() => { load(); }, [id]);

  async function load() {
    try {
      const data = await api.get(`/proposals/${id}`);
      setProposal(data);
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
          <h1>{proposal.client_name || "Proposal"}</h1>
          <p className="lede">{proposal.event_name || "No event"} · {proposal.status} · Total {formatMoney(proposal.total || 0)}</p>
        </div>
        <div className="detail-actions">
          {can("write:sales") && ["DRAFT", "READY"].includes(proposal.status) && proposal.proposal_source !== "UPLOADED" && <Link className="primary-action" to={`/sales/proposals/${id}/edit`}>Edit proposal</Link>}
          {accessAvailable && proposal.public_url && <a href={proposal.public_url} target="_blank" rel="noreferrer">Public proposal</a>}
          <button disabled={busy || !accessAvailable} className="primary-action" onClick={() => {setRecipient(proposal.client_email || "");setSendOpen(true);}}><Mail size={16} />Send</button>
          <button disabled={busy} onClick={() => action(() => api.download(`/proposals/${id}/pdf`, `${proposal.proposal_number}.pdf`), "PDF generated.")}><Download size={16} />PDF</button>
          <button disabled={busy} onClick={() => action(() => api.download(`/proposals/${id}/docx`, `${proposal.proposal_number}.docx`), "DOCX generated.")}><FileText size={16} />DOCX</button>
          <button disabled={busy} onClick={() => action(() => api.post(`/proposals/${id}/duplicate`, {}), "Proposal duplicated.")}><Copy size={16} />Duplicate</button>
          <button disabled={busy} onClick={() => action(() => api.post(`/proposals/${id}/archive`, {}), "Proposal archived.")}><Archive size={16} />Archive</button>
          {proposal.linked_invoice_id ? <Link className="primary-action" to={`/finance/invoices/${proposal.linked_invoice_id}`}><ReceiptText size={16} />Open Invoice</Link> : <button className="primary-action" disabled={busy||proposal.status !== "ACCEPTED"} onClick={createInvoiceFromProposal}><ReceiptText size={16} />Create Invoice</button>}
        </div>
      </div>
      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
      {sendOpen && <form className="panel" onSubmit={event=>{event.preventDefault();action(async()=>{await api.post(`/proposals/${id}/send`,{recipient:recipient.trim()});setSendOpen(false);},"Proposal submitted to the email provider.");}}>
        <h2>Send proposal</h2>
        <p>The recipient will receive a link to this proposal and an attached PDF.</p>
        <label>Recipient email<input type="email" required disabled={busy} value={recipient} onChange={event=>setRecipient(event.target.value)}/></label>
        <div className="button-row"><button className="primary-action" disabled={busy}>{busy?"Sending…":"Send proposal email"}</button><button type="button" disabled={busy} onClick={()=>setSendOpen(false)}>Cancel</button></div>
      </form>}
      {proposal.status === "ACCEPTED" && !proposal.linked_invoice_id && <section className="panel"><h2>Proposal accepted</h2><p><strong>Next step:</strong> create one invoice for this proposal. The invoice tracks the full proposal total, requests the configured deposit first, and then continues with the remaining balance.</p><div className="button-row"><button className="primary-action" disabled={busy} onClick={createInvoiceFromProposal}><ReceiptText size={16} />Create Invoice</button></div></section>}
      {proposal.linked_invoice_id && <section className="panel"><h2>Invoice created</h2><p>{proposal.linked_invoice_number || "The linked invoice"} · {proposal.linked_invoice_status || "Current"}. Deposit and remaining balance are managed on this single invoice.</p><Link className="primary-action" to={`/finance/invoices/${proposal.linked_invoice_id}`}><ReceiptText size={16} />Open Invoice</Link></section>}
      {!accessAvailable && <section className="panel"><p role="status">Public access not available.</p>{can("write:sales") && <button disabled={busy} onClick={()=>action(()=>api.post(`/proposals/${id}/ensure-access`,{}),"Secure access generated.")}>Generate Secure Access</button>}</section>}
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
        <AdminProposalPreview id={id} />
      </section>
    </main>
  );
}

function Metric({ label, value }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
