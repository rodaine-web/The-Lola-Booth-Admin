import { formatMoney } from "../utils/display.js";
import { ArrowLeft, Download, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";

export default function PaymentDetail() {
  const { id } = useParams();
  const [payment, setPayment] = useState(null);
  const [refund, setRefund] = useState({ amount: "", reason: "", notes: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { load(); }, [id]);

  async function load() {
    try {
      setPayment(await api.get(`/payments/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitRefund() {
    setError("");
    setNotice("");
    try {
      await api.post(`/payments/${id}/refunds`, { ...refund, idempotency_key: `refund-${id}-${refund.amount}` });
      setNotice("Refund recorded.");
      setRefund({ amount: "", reason: "", notes: "" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !payment) return <main className="page"><div className="empty-state">{error}</div></main>;
  if (!payment) return <main className="page"><div className="empty-state">Loading payment...</div></main>;
  const refundable = Math.max(0, Number(payment.amount || 0) - Number(payment.refunded_amount || 0));

  return (
    <main className="page">
      <div className="detail-back"><Link to="/finance/payments"><ArrowLeft size={16} />Back to payments</Link></div>
      <div className="page-heading detail-heading">
        <div><p className="eyebrow">{payment.provider}</p><h1>{formatMoney(payment.amount || 0)}</h1><p className="lede">{payment.client_name} · {payment.invoice_number} · {payment.status}</p></div>
        <div className="detail-actions">
          {payment.invoice_id && <Link className="primary-action" to={`/finance/invoices/${payment.invoice_id}`}>View Invoice</Link>}
          {payment.event_id && <Link className="primary-action" to={`/events/events/${payment.event_id}`}>View Event</Link>}
          {payment.client_id && <Link className="primary-action" to={`/sales/clients/${payment.client_id}`}>View Client</Link>}
          <button onClick={() => api.download(`/payments/${payment.id}/receipt.pdf`, `receipt-${payment.id.slice(0, 8)}.pdf`)}><Download size={16} />Receipt</button>
        </div>
      </div>
      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
      <section className="detail-summary">
        <Metric label="Method" value={payment.payment_method} />
        <Metric label="Reference" value={payment.provider_payment_id || payment.reference_number || "None"} />
        <Metric label="Paid" value={payment.paid_at || payment.payment_date} />
        <Metric label="Refundable" value={`$${refundable.toLocaleString()}`} />
      </section>
      <section className="panel">
        <h2>Refund</h2>
        <div className="inline-form note-form">
          <input type="number" min="0" max={refundable} value={refund.amount} onChange={(event) => setRefund((current) => ({ ...current, amount: event.target.value }))} placeholder="Refund amount" />
          <input value={refund.reason} onChange={(event) => setRefund((current) => ({ ...current, reason: event.target.value }))} placeholder="Reason" />
          <button className="primary-action" disabled={!refund.amount || Number(refund.amount) > refundable} onClick={submitRefund}><RotateCcw size={16} />Refund</button>
        </div>
      </section>
      <section className="panel"><h2>Refund History</h2><DataTable rows={payment.refunds} columns={["refund_date", "amount", "status", "reason", "provider_reference"]} empty="No refunds recorded." /></section>
    </main>
  );
}

function Metric({ label, value }) { return <article className="metric"><span>{label}</span><strong>{value || "—"}</strong></article>; }
