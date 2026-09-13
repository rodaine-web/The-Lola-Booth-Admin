import { Archive, ArrowLeft, Copy, Download, FileText, Mail, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";

export default function ProposalDetail() {
  const { id } = useParams();
  const [proposal, setProposal] = useState(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { load(); }, [id]);

  async function load() {
    try {
      const data = await api.get(`/proposals/${id}`);
      setProposal(data);
      setPreview(await api.text(`/proposals/${id}/preview`));
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

  if (error && !proposal) return <main className="page"><div className="empty-state">{error}</div></main>;
  if (!proposal) return <main className="page"><div className="empty-state">Loading proposal...</div></main>;

  return (
    <main className="page">
      <div className="detail-back"><Link to="/sales/proposals"><ArrowLeft size={16} />Back to proposals</Link></div>
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">{proposal.proposal_number}</p>
          <h1>{proposal.client_name || "Proposal"}</h1>
          <p className="lede">{proposal.event_name || "No event"} · {proposal.status} · Total ${Number(proposal.total || 0).toLocaleString()}</p>
        </div>
        <div className="detail-actions">
          <button className="primary-action" onClick={() => action(() => api.post(`/proposals/${id}/send`, {}), "Proposal sent in development email mode.")}><Mail size={16} />Send</button>
          <button onClick={() => action(() => api.download(`/proposals/${id}/pdf`, `${proposal.proposal_number}.pdf`), "PDF generated.")}><Download size={16} />PDF</button>
          <button onClick={() => action(() => api.download(`/proposals/${id}/docx`, `${proposal.proposal_number}.docx`), "DOCX generated.")}><FileText size={16} />DOCX</button>
          <button onClick={() => action(() => api.post(`/proposals/${id}/duplicate`, {}), "Proposal duplicated.")}><Copy size={16} />Duplicate</button>
          <button onClick={() => action(() => api.post(`/proposals/${id}/archive`, {}), "Proposal archived.")}><Archive size={16} />Archive</button>
          <button className="primary-action" disabled={proposal.status !== "ACCEPTED"} onClick={() => action(() => api.post(`/proposals/${id}/create-invoice`, { depositOnly: true }), "Deposit invoice created.")}><ReceiptText size={16} />Deposit Invoice</button>
        </div>
      </div>
      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
      <section className="detail-summary">
        <Metric label="Valid Through" value={proposal.valid_through || "Unset"} />
        <Metric label="Sent" value={proposal.sent_at ? new Date(proposal.sent_at).toLocaleDateString() : "Not sent"} />
        <Metric label="Views" value={proposal.view_count || 0} />
        <Metric label="Accepted By" value={proposal.accepted_by_name || "Not accepted"} />
      </section>
      <iframe className="document-preview" title="Proposal preview" srcDoc={preview} />
    </main>
  );
}

function Metric({ label, value }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
