import test from "node:test";
import assert from "node:assert/strict";
import { receiptView } from "../shared/receipt-view.js";
const first = {
  id: "aaaa0000-0000-0000-0000-000000000000",
  amount: 300,
  status: "SUCCEEDED",
  paid_at: "2026-09-01T10:00:00Z",
  currency: "USD",
};
const second = {
  id: "bbbb0000-0000-0000-0000-000000000000",
  amount: 700,
  status: "SUCCEEDED",
  paid_at: "2026-09-02T10:00:00Z",
  currency: "USD",
};
test("partial receipt displays authoritative balance and distinguishes this payment", () => {
  const r = receiptView(
    {
      total: 1000,
      amount_paid: 300,
      amount_outstanding: 700,
      invoice_number: "QA-1",
    },
    first,
    [first],
  );
  assert.equal(r.status, "PARTIALLY_PAID");
  assert.equal(r.previouslyPaid, 0);
  assert.equal(r.thisPayment, 300);
  assert.equal(r.totalPaid, 300);
  assert.equal(r.balanceDue, 700);
});
test("full payment receipt preserves zero over stale legacy balance", () => {
  const r = receiptView(
    {
      total: 1000,
      amount_paid: 1000,
      amount_outstanding: 0,
      balance_due: 700,
      status: "PAID",
    },
    second,
    [first, second],
  );
  assert.equal(r.previouslyPaid, 300);
  assert.equal(r.thisPayment, 700);
  assert.equal(r.totalPaid, 1000);
  assert.equal(r.balanceDue, 0);
  assert.equal(r.status, "PAID");
});
test("refund receipt distinguishes original amount, refund, net and current invoice state", () => {
  const refunded = {
    ...second,
    refunded_amount: 200,
    status: "PARTIALLY_REFUNDED",
  };
  const r = receiptView(
    {
      total: 1000,
      amount_paid: 800,
      amount_outstanding: 200,
      status: "PARTIALLY_PAID",
    },
    refunded,
    [first, refunded],
  );
  assert.equal(r.thisPayment, 700);
  assert.equal(r.refunded, 200);
  assert.equal(r.netPayment, 500);
  assert.equal(r.totalPaid, 800);
  assert.equal(r.balanceDue, 200);
  assert.equal(r.status, "PARTIALLY_REFUNDED");
});
test("later receipts do not inflate previously-paid amount on earlier receipts", () => {
  const r = receiptView(
    { total: 1000, amount_paid: 1000, amount_outstanding: 0 },
    first,
    [first, second],
  );
  assert.equal(r.previouslyPaid, 0);
  assert.equal(r.totalPaid, 1000);
});
test("receipt dates remain complete calendar dates for PostgreSQL timestamp objects", () => {
  const r = receiptView(
    { total: 500, amount_paid: 500, amount_outstanding: 0 },
    {
      ...first,
      payment_date: "2026-09-29",
      paid_at: new Date("2026-09-30T03:00:00Z"),
    },
    [first],
  );
  assert.equal(r.paymentDate, "2026-09-29");
});
