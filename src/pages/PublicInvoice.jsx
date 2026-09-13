import { CreditCard, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import DataTable from "../components/DataTable.jsx";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export default function PublicInvoice() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const [invoice, setInvoice] = useState(null);
  const [paymentOptions, setPaymentOptions] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/public/invoices/${token}`).then((res) => res.json()).then((payload) => {
      setInvoice(payload.invoice);
      setPaymentOptions(payload.paymentOptions);
    }).catch((err) => setError(err.message));
  }, [token]);

  async function pay(provider) {
    setBusy(provider);
    setError("");
    const response = await fetch(`${API_URL}/public/invoices/${token}/payment-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, idempotencyKey: `${provider}-${token}` })
    });
    const payload = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setError(payload.error?.message || "Payment checkout is not available.");
      return;
    }
    window.location.href = payload.checkoutUrl;
  }

  if (error) return <main className="public-document"><div className="toast error">{error}</div></main>;
  if (!invoice) return <main className="public-document"><div className="empty-state">Loading invoice...</div></main>;
  const amountDue = Number(invoice.amount_outstanding || invoice.balance_due || 0);
  const amountPaid = Number(invoice.amount_paid || 0);
  const paymentSucceeded = searchParams.get("payment") === "success";

  return (
    <main className="public-document">
      <div className="brand large public-brand"><img className="brand-logo brand-logo-public-stacked" src="/brand/LOLA_Primary_Dark_Transparent.png" alt="The LOLA Booth" /><div><strong>LOLA Booths</strong><span>Good people. Better photos.</span></div></div>
      <div className="public-heading">
        <p className="eyebrow">{invoice.invoice_number}</p>
        <h1>Invoice</h1>
        <p className="lede">{invoice.client_name || "Client"} · Due {invoice.due_date || "TBD"}</p>
      </div>
      {paymentSucceeded && (
        <section className="public-success">
          <CreditCard size={22} />
          <div>
            <h2>Payment received.</h2>
            <p>Thanks for your payment. Gateway verification may take a moment to refresh the final invoice balance.</p>
          </div>
        </section>
      )}
      <section className="detail-summary">
        <Metric label="Total" value={`$${Number(invoice.total || 0).toLocaleString()}`} />
        <Metric label="Paid" value={`$${amountPaid.toLocaleString()}`} />
        <Metric label="Amount Due" value={`$${amountDue.toLocaleString()}`} />
        <Metric label="Status" value={invoice.status} />
      </section>
      <section className="panel"><h2>Line Items</h2><DataTable rows={invoice.items} columns={["description", "quantity", "unit_price", "line_total"]} empty="No invoice items." /></section>
      <section className="panel">
        <h2>Payment</h2>
        <p className="note-text">Amount due: ${Number(paymentOptions?.amountDue || invoice.amount_outstanding || invoice.balance_due || 0).toLocaleString()}. Flexible payment options may be available at checkout.</p>
        {paymentOptions?.providers?.length ? (
          <div className="quick-actions">
            {paymentOptions.providers.map((provider) => (
              <button key={provider.provider} className="primary-action" disabled={busy === provider.provider} onClick={() => pay(provider.provider)}>
                <CreditCard size={16} />{busy === provider.provider ? "Opening..." : provider.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="note-text">{paymentOptions?.offlinePaymentInstructions || "Online checkout is not configured for this invoice."}</p>
        )}
      </section>
      <a className="primary-action public-download" href={`${API_URL}/public/invoices/${token}/pdf`}><Download size={16} />Download PDF</a>
    </main>
  );
}

function Metric({ label, value }) { return <article className={`metric ${label === "Amount Due" ? "metric-strong" : ""}`}><span>{label}</span><strong>{value}</strong></article>; }
