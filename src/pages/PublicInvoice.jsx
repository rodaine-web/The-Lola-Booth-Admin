import { formatMoney, formatDateOnly } from "../utils/display.js";
import { CreditCard, Download } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import DataTable from "../components/DataTable.jsx";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export default function PublicInvoice() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const [invoice, setInvoice] = useState(null);
  const [paymentOptions, setPaymentOptions] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const paymentKeys=useRef({}),paymentLock=useRef(false);

  async function load(){
    setError("");
    try{const session=searchParams.get('session_id');const res=await fetch(`${API_URL}/public/invoices/${token}${session?'?session_id='+encodeURIComponent(session):''}`,{cache:'no-store'});const payload=await res.json();if(!res.ok)throw new Error(payload.error?.message||"This invoice link is unavailable or has expired.");setInvoice(payload.invoice);setPaymentOptions(payload.paymentOptions);setConfirmation(payload.checkoutConfirmation);}
    catch(err){setError(err.message);}
  }
  useEffect(()=>{setInvoice(null);load();},[token]);
  useEffect(() => {
    if (invoice && window.location.hash === "#payment-options") {
      document.getElementById("payment-options")?.scrollIntoView();
    }
  }, [invoice]);
  async function pay(provider){
    if(paymentLock.current)return;paymentLock.current=true;setBusy(provider);setError("");
    try{const res=await fetch(`${API_URL}/public/invoices/${token}/payment-session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,idempotencyKey:paymentKeys.current[`${token}:${provider}`]??=(crypto.randomUUID())})});const data=await res.json();if(!res.ok)throw new Error(data.error?.message||'Checkout is unavailable. Please try again.');const url=new URL(data.checkoutUrl);if(url.protocol!=='https:'||!['checkout.stripe.com','www.paypal.com','www.sandbox.paypal.com'].includes(url.hostname))throw new Error('Invalid checkout destination.');window.location.assign(url.href);}catch(err){setError(err.message);}finally{setBusy('');paymentLock.current=false;}
  }

  if (error&&!invoice) return <main className="public-document"><h1>Invoice unavailable</h1><div role="alert" className="toast error">{error}</div><button className="primary-action" onClick={load}>Try again</button><a href="/pay">Request a new link</a></main>;
  if (!invoice) return <main className="public-document"><div className="empty-state">Loading invoice...</div></main>;
  const amountDue = Number(invoice.amount_outstanding ?? invoice.balance_due ?? 0);
  const amountPaid = Number(invoice.amount_paid || 0);
  const paymentSucceeded = searchParams.get("payment") === "success";

  return (
    <main className="public-document">
      <div className="brand large public-brand"><img className="brand-logo brand-logo-public-stacked" src={`${import.meta.env.BASE_URL}brand/LOLA_Primary_Dark_Transparent.png`} alt="The LOLA Booth" /><div><strong>LOLA Booths</strong><span>Good people. Better photos.</span></div></div>
      <div className="public-heading">
        <p className="eyebrow">{invoice.invoice_number}</p>
        <h1>Invoice</h1>
        <p className="lede">{invoice.client_name || "Client"} · {invoice.event_name || "Your event"} · Due {formatDateOnly(invoice.due_date)}</p>
      </div>
      {paymentSucceeded && (
        <section className="public-success">
          <CreditCard size={22} />
          <div>
            <h2>{['CONFIRMED','RECORDED'].includes(confirmation?.status)?"Payment recorded":"Checking payment confirmation"}</h2>
            <p>{['CONFIRMED','RECORDED'].includes(confirmation?.status)?`${formatMoney(confirmation.amount)} recorded. Remaining balance: ${formatMoney(amountDue)}.`:"Your balance changes only after provider verification. Use Refresh status to check the latest result. Please do not submit another payment while confirmation is pending."}</p>
          </div>
        </section>
      )}
      {error&&<p role="alert" className="toast error">{error}</p>}
      <button className="primary-action" onClick={load}>Refresh status</button>
      <section className="detail-summary">
        <Metric label="Total" value={formatMoney(invoice.total || 0)} />
        <Metric label="Paid" value={formatMoney(amountPaid)} />
        <Metric label="Amount Due" value={formatMoney(amountDue)} />
        <Metric label="Status" value={invoice.status} />
      </section>
      <section className="panel public-invoice-items"><h2>Line Items</h2><DataTable rows={invoice.items} columns={["description", "quantity", "unit_price", "line_total"]} empty="No invoice items." /></section>
      {amountDue <= 0 ? <section className="panel" id="payment-options"><h2>No payment due</h2><p>This invoice has no outstanding balance.</p></section> : <section className="panel" id="payment-options">
        <h2>Choose payment method</h2>
        <p className="note-text">Amount due: {formatMoney(paymentOptions?.amountDue ?? invoice.amount_outstanding ?? invoice.balance_due ?? 0)}. Flexible payment options may be available at checkout.</p>
        {paymentOptions?.providers?.length ? (
          <div className="quick-actions">
            {paymentOptions.providers.map((provider) => (
              <button key={provider.provider} className="primary-action" disabled={Boolean(busy)} onClick={() => pay(provider.provider)}>
                <CreditCard size={16} />{busy === provider.provider ? "Opening..." : provider.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="note-text">{paymentOptions?.offlinePaymentInstructions || "Online checkout is not configured for this invoice."}</p>
        )}
      </section>}
      {invoice.payments?.some(p=>p.receipt_available)&&<section className="panel"><h2>Receipts</h2>{invoice.payments.filter(p=>p.receipt_available).map(p=><p key={p.id}><a href={`/receipt/${token}/${p.id}`}>View receipt · {formatMoney(p.amount)} · {formatDateOnly(p.payment_date)}</a></p>)}</section>}
      <a className="primary-action public-download" href={`${API_URL}/public/invoices/${token}/pdf`}><Download size={16} />Download PDF</a>
    </main>
  );
}

function Metric({ label, value }) { return <article className={`metric ${label === "Amount Due" ? "metric-strong" : ""}`}><span>{label}</span><strong>{value}</strong></article>; }
