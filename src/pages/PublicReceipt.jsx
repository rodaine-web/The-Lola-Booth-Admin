import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Download, CheckCircle2, ArrowLeft } from "lucide-react";
import { formatDateOnly, formatMoney } from "../utils/display.js";
const API = import.meta.env.VITE_API_URL || "/api";
export default function PublicReceipt() {
  const { token, id } = useParams(),
    [receipt, setReceipt] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    fetch(`${API}/public/invoices/${token}/receipts/${id}`)
      .then(async (r) => {
        if (!r.ok)
          throw Error(
            "This receipt is unavailable. Please use the secure link from your invoice.",
          );
        const data = await r.json();
        if (current) setReceipt(data);
      })
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [token, id]);
  const money = (v) => formatMoney(v, receipt?.currency);
  return (
    <main className="receipt-page">
      <article className="receipt-paper">
        <img
          className="receipt-logo"
          src="/brand/LOLA_Primary_Dark_Transparent.png"
          alt="The LOLA Booth"
        />
        <p className="eyebrow">PAYMENT RECEIPT</p>
        <h1>
          {receipt?.refunded
            ? "Payment & refund record"
            : "Thank you for your payment."}
        </h1>
        {error ? (
          <p role="alert">{error}</p>
        ) : !receipt ? (
          <p>Opening your receipt…</p>
        ) : (
          <>
            <p className="receipt-number">
              {receipt.number} · {receipt.invoiceNumber}
            </p>
            <h2 className="receipt-section-title">Payment details</h2>
            <dl className="receipt-details">
              {[
                ["Client", receipt.client],
                ["Event", receipt.event],
                ["Event date", formatDateOnly(receipt.eventDate)],
                ["Payment date", formatDateOnly(receipt.paymentDate)],
                ["Payment method", receipt.method],
                ["Provider", receipt.provider],
                ["Currency", receipt.currency],
                ["Payment status", receipt.paymentStatus],
                ...(receipt.refunded
                  ? [
                      [
                        "Refund date",
                        receipt.refundDate
                          ? formatDateOnly(receipt.refundDate)
                          : "Not recorded",
                      ],
                    ]
                  : []),
                ...(receipt.balanceDue > 0
                  ? [["Due date", formatDateOnly(receipt.dueDate)]]
                  : []),
                ["Provider reference", receipt.reference],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || "—"}</dd>
                </div>
              ))}
            </dl>
            <h2 className="receipt-section-title">Invoice summary</h2>
            <div className="receipt-totals">
              {[
                ["Invoice total", receipt.invoiceTotal],
                ["Previously paid (net)", receipt.previouslyPaid],
                ["This payment", receipt.thisPayment],
                ...(receipt.refunded
                  ? [["Refunded from this payment", receipt.refunded]]
                  : []),
                ["Total paid to date (net)", receipt.totalPaid],
                ["Remaining balance", receipt.balanceDue],
              ].map(([label, value]) => (
                <div
                  className={
                    ["This payment", "Remaining balance"].includes(label)
                      ? "strong"
                      : ""
                  }
                  key={label}
                >
                  <span>{label}</span>
                  <strong>{money(value)}</strong>
                </div>
              ))}
            </div>
            <p
              className={`receipt-status ${receipt.status === "PAID" ? "paid" : ""}`}
            >
              <CheckCircle2 size={17} />
              {receipt.status === "PAID"
                ? "PAID IN FULL"
                : receipt.status.replaceAll("_", " ")}
            </p>
            <p className="receipt-thanks">
              We appreciate you choosing The Lola Booth and look forward to
              being part of your event.
            </p>
            <div className="receipt-actions">
              {receipt.balanceDue > 0 && (
                <Link className="primary-action" to={`/pay/${token}`}>
                  Pay remaining balance
                </Link>
              )}
              <a
                className="primary-action"
                href={`${API}/public/invoices/${token}/receipts/${id}/pdf`}
              >
                <Download size={16} />
                Download receipt
              </a>
              <Link className="secondary-action" to={`/invoice/${token}`}>
                <ArrowLeft size={16} />
                View invoice
              </Link>
            </div>
          </>
        )}
        <footer>
          Good people. Better photos.<small>THE LOLA BOOTH</small>
        </footer>
      </article>
    </main>
  );
}
