import AsyncState from "../components/AsyncState.jsx";
import { formatDateOnly, formatMoney, formatTimestamp } from "../utils/display.js";
import { Archive, ArrowLeft, Copy, Download, FileText, Mail, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import DocumentPreview from "../components/DocumentPreview.jsx";
import { api } from "../api/client.js";

export default function ProposalDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [proposal, setProposal] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !proposal) return <main className="page"><AsyncState error={error} noun="proposal" onRetry={()=>{setError("");load();}}/></main>;
  if (!proposal) return <main className="page"><div className="empty-state">Loading proposal...</div></main>;

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
          {proposal.public_url && <a href={proposal.public_url} target="_blank" rel="noreferrer">Public proposal</a>}
          <button className="primary-action" onClick={() => action(() => api.post(`/proposals/${id}/send`, {}), "Proposal submitted to the email provider.")}><Mail size={16} />Send</button>
          <button onClick={() => action(() => api.download(`/proposals/${id}/pdf`, `${proposal.proposal_number}.pdf`), "PDF generated.")}><Download size={16} />PDF</button>
          <button onClick={() => action(() => api.download(`/proposals/${id}/docx`, `${proposal.proposal_number}.docx`), "DOCX generated.")}><FileText size={16} />DOCX</button>
          <button onClick={() => action(() => api.post(`/proposals/${id}/duplicate`, {}), "Proposal duplicated.")}><Copy size={16} />Duplicate</button>
          <button onClick={() => action(() => api.post(`/proposals/${id}/archive`, {}), "Proposal archived.")}><Archive size={16} />Archive</button>
          <button className="primary-action" disabled={proposal.status !== "ACCEPTED"} onClick={() => action(() => api.post(`/proposals/${id}/create-invoice`, { depositOnly: true }), "Deposit invoice created.")}><ReceiptText size={16} />Deposit Invoice</button>
        </div>
      </div>
      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
      <section className="detail-summary">
        <Metric label="Valid Through" value={proposal.valid_through ? formatDateOnly(proposal.valid_through) : "Unset"} />
        <Metric label="Sent" value={proposal.sent_at ? new Date(proposal.sent_at).toLocaleDateString() : "Not sent"} />
        <Metric label="Views" value={proposal.view_count || 0} />
        <Metric label="Accepted By" value={proposal.accepted_by_name || "Not accepted"} />
      </section>
      <section className="panel"><h2>Version history</h2>{proposal.versions?.length ? <ul>{proposal.versions.map(version => <li key={version.id}>Version {version.version_number} · {new Date(version.created_at).toLocaleString()}</li>)}</ul> : <p>No saved versions.</p>}</section>
      <DocumentPreview path={`/proposals/${id}/pdf`} title="Proposal preview" />
    </main>
  );
}

function Metric({ label, value }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
