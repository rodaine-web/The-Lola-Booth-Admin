import { formatMoney } from "../utils/display.js";
import { CheckCircle2, Download, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export default function PublicProposal() {
  const { token } = useParams();
  const [payload, setPayload] = useState(null);
  const [acceptedByName, setAcceptedByName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/public/proposals/${token}`).then((res) => res.json()).then(setPayload).catch((err) => setError(err.message));
  }, [token]);

  async function decide(path, body) {
    setError("");
    setNotice("");
    const response = await fetch(`${API_URL}/public/proposals/${token}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    if (!response.ok) {
      setError("We could not update this proposal.");
      return;
    }
    setPayload(await response.json());
    setNotice(path === "accept" ? "Proposal accepted. Thank you." : "Proposal declined.");
  }

  if (error) return <PublicShell><div className="toast error">{error}</div></PublicShell>;
  if (!payload) return <PublicShell><div className="empty-state">Loading proposal...</div></PublicShell>;
  const proposal = payload.proposal || payload;
  const pricing = proposal.pricing_snapshot || {};

  return (
    <PublicShell>
      <div className="public-heading">
        <p className="eyebrow">{proposal.proposal_number}</p>
        <h1>Proposal for {proposal.client_name || "your event"}</h1>
        <p className="lede">{proposal.event_name || proposal.event_type} · {proposal.event_date || "Date TBD"}</p>
      </div>
      {(notice || error) && <div className={error ? "toast error" : "toast"}>{notice || error}</div>}
      {proposal.status === "ACCEPTED" && (
        <section className="public-success">
          <CheckCircle2 size={22} />
          <div>
            <h2>Let's make it official.</h2>
            <p>Thank you. Your proposal is accepted and the LOLA team can move the booking into its next step.</p>
          </div>
        </section>
      )}
      <section className="detail-summary">
        <Metric label="Total" value={formatMoney(pricing.total || proposal.total || 0)} />
        <Metric label="Deposit" value={formatMoney(pricing.deposit_amount || 0)} />
        <Metric label="Balance" value={formatMoney(pricing.balance || 0)} />
        <Metric label="Status" value={proposal.status} />
      </section>
      <iframe className="document-preview" title="Proposal preview" src={`${API_URL}/public/proposals/${token}/preview`} />
      <section className="panel">
        <h2>Acceptance</h2>
        <p className="note-text">{payload.acceptanceWording}</p>
        <div className="inline-form note-form">
          <input value={acceptedByName} onChange={(event) => setAcceptedByName(event.target.value)} placeholder="Your full name" />
          <button className="primary-action" disabled={!acceptedByName.trim() || proposal.status === "ACCEPTED"} onClick={() => decide("accept", { acceptedByName })}><CheckCircle2 size={16} />Accept</button>
          <button disabled={proposal.status === "ACCEPTED"} onClick={() => decide("decline")}><XCircle size={16} />Decline</button>
          <a className="primary-action" href={`${API_URL}/public/proposals/${token}/pdf`}><Download size={16} />PDF</a>
        </div>
      </section>
    </PublicShell>
  );
}

function PublicShell({ children }) { return <main className="public-document"><div className="brand large public-brand"><img className="brand-logo brand-logo-public-stacked" src="/brand/LOLA_Primary_Dark_Transparent.png" alt="The LOLA Booth" /><div><strong>LOLA Booths</strong><span>Good people. Better photos.</span></div></div>{children}</main>; }
function Metric({ label, value }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
