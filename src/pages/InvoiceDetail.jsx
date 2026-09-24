import AsyncState from "../components/AsyncState.jsx";
import { formatDateOnly, formatMoney, formatTimestamp } from "../utils/display.js";
import { ArrowLeft, Copy, Download, Mail, Plus, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import DocumentPreview from "../components/DocumentPreview.jsx";
import DataTable from "../components/DataTable.jsx";

export default function InvoiceDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const canEdit = user?.permissions?.some(p => ["*", "write:finance"].includes(p));
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [payment, setPayment] = useState({ amount: "", payment_method: "CASH", reference_number: "", payment_date: new Date().toISOString().slice(0, 10), notes: "" });

  useEffect(() => { load(); }, [id]);

  async function load() {
    try {
      setInvoice(await api.get(`/invoices/${id}`));
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

  async function recordPayment() {
    await action(() => api.post("/payments", {
      ...payment,
      amount: payment.amount,
      invoice_id: invoice.id,
      client_id: invoice.client_id,
      event_id: invoice.event_id,
      idempotency_key: `manual-${invoice.id}-${payment.amount}-${payment.payment_date}-${payment.reference_number}`
    }), "Manual payment recorded.");
    setPayment((current) => ({ ...current, amount: "", reference_number: "", notes: "" }));
  }

  if (error && !invoice) return <main className="page"><AsyncState error={error} noun="invoice" onRetry={()=>{setError("");load();}}/></main>;
  if (!invoice) return <main className="page"><div className="empty-state">Loading invoice...</div></main>;

  return (
    <main className="page">
      <div className="detail-back"><Link to="/finance/invoices"><ArrowLeft size={16} />Back to invoices</Link></div>
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">{invoice.invoice_number}</p>
          <h1>{invoice.client_name || "Invoice"}</h1>
          <p className="lede">{invoice.event_name || "No event"} · {invoice.status} · Outstanding {formatMoney(invoice.amount_outstanding ?? invoice.balance_due ?? 0)}</p>
        </div>
        <div className="detail-actions">
          {invoice.public_url && <a href={invoice.public_url} target="_blank" rel="noreferrer">Public invoice</a>}
          {canEdit && invoice.status === "DRAFT" && Number(invoice.amount_paid || 0) === 0 && <Link className="primary-action" to={`/finance/invoices/${id}/edit`}>Edit draft</Link>}
          <button className="primary-action" onClick={() => action(() => api.post(`/invoices/${id}/send`, {}), "Invoice submitted to the email provider.")}><Mail size={16} />Send</button>
          <button onClick={() => action(() => api.download(`/invoices/${id}/pdf`, `${invoice.invoice_number}.pdf`), "PDF generated.")}><Download size={16} />PDF</button>
          <button onClick={() => action(() => api.post(`/invoices/${id}/duplicate`, {}), "Invoice duplicated.")}><Copy size={16} />Duplicate</button>
          <button onClick={() => action(() => api.post(`/invoices/${id}/void`, {}), "Invoice voided.")}><XCircle size={16} />Void</button>
        </div>
      </div>
      {(error || notice) && <div className={error ? "toast error" : "toast"}>{error || notice}</div>}
      {invoice.data_quality==='INCOMPLETE_HISTORICAL'&&<p className="toast" role="status">Historical invoice: line-item detail is missing. Original amounts are preserved; do not reconstruct charges without source records.</p>}
      <section className="detail-summary">
        <Metric label="Total" value={formatMoney(invoice.total || 0)} />
        <Metric label="Paid" value={formatMoney(invoice.amount_paid || 0)} />
        <Metric label="Outstanding" value={formatMoney(invoice.amount_outstanding ?? invoice.balance_due ?? 0)} />
        <Metric label="Due" value={invoice.due_date ? formatDateOnly(invoice.due_date) : "Unset"} />
      </section>
      <section className="panel">
        <h2>Line Items</h2>
        <DataTable rows={invoice.items} columns={["description", "quantity", "unit_price", "tax_rate", "discount", "line_total"]} empty="No invoice items." />
      </section>
      <DocumentPreview path={`/invoices/${id}/pdf`} title="Invoice preview" />
      <section className="panel">
        <h2>Record Manual Payment</h2>
        <div className="inline-form">
          <input type="number" min="0" max={invoice.amount_outstanding || invoice.balance_due} value={payment.amount} onChange={(event) => setPayment((current) => ({ ...current, amount: event.target.value }))} placeholder="Amount" />
          <select value={payment.payment_method} onChange={(event) => setPayment((current) => ({ ...current, payment_method: event.target.value }))}>{["CASH", "CHECK", "BANK_TRANSFER", "ZELLE", "EXTERNAL_CARD", "OTHER"].map((item) => <option key={item}>{item}</option>)}</select>
          <input type="date" value={payment.payment_date} onChange={(event) => setPayment((current) => ({ ...current, payment_date: event.target.value }))} />
          <input value={payment.reference_number} onChange={(event) => setPayment((current) => ({ ...current, reference_number: event.target.value }))} placeholder="Reference" />
          <button className="primary-action" disabled={!payment.amount} onClick={recordPayment}><Plus size={16} />Record</button>
        </div>
      </section>
      <section className="panel">
        <h2>Payment History</h2>
        <DataTable rows={invoice.payments} columns={["payment_date", "provider", "payment_method", "amount", "refunded_amount", "status", "reference_number"]} getRowHref={(row) => `/finance/payments/${row.id}`} empty="No payments recorded." />
      </section>
    </main>
  );
}

function Metric({ label, value }) { return <article className="metric"><span>{label}</span><strong>{value}</strong></article>; }
