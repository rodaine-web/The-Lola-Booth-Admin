import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const database = process.env.GALLERY_TEST_DATABASE_URL;
test(
  "receipt HTTP authorization and authoritative totals",
  { skip: !database },
  async (t) => {
    const url = new URL(database);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname.endsWith("_qa"),
    );
    Object.assign(process.env, {
      DATABASE_URL: database,
      APP_ENV: "test",
      NODE_ENV: "test",
      JWT_SECRET: "synthetic-receipt-http-test-secret-32chars",
    });
    const { query, pool } = await import("../server/src/db/pool.js");
    const { default: express } = await import("express");
    const { publicRouter } = await import("../server/src/routes/public.js");
    const { errorHandler } =
      await import("../server/src/middleware/error-handler.js");
    const token = crypto.randomBytes(24).toString("hex");
    const client = (
      await query(
        "INSERT INTO clients(name) VALUES('RECEIPT QA Client') RETURNING id",
      )
    ).rows[0];
    const event = (
      await query(
        "INSERT INTO events(event_name,event_type,event_date,status) VALUES('RECEIPT QA','CORPORATE','2026-11-21','INQUIRY') RETURNING id",
      )
    ).rows[0];
    const invoice = (
      await query(
        "INSERT INTO invoices(invoice_number,total,amount_paid,amount_outstanding,balance_due,secure_token,status) VALUES($1,1500,500,1000,1000,$2,'PARTIALLY_PAID') RETURNING id",
        ["RECEIPT-QA-" + crypto.randomUUID(), token],
      )
    ).rows[0];
    const payment = (
      await query(
        "INSERT INTO payments(invoice_id,event_id,client_id,amount,payment_method,provider,status,payment_date,paid_at,reference_number) VALUES($1,$2,$3,500,'CARD','STRIPE','SUCCEEDED','2026-09-29',now(),'QA-NO-CHARGE') RETURNING id",
        [invoice.id, event.id, client.id],
      )
    ).rows[0];
    const app = express();
    app.use(express.json());
    app.use("/api/public", publicRouter);
    app.use(errorHandler);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/public/invoices/${token}/receipts/`;
    try {
      await t.test(
        "receipt exposes normalized amounts and full payment date",
        async () => {
          const r = await fetch(base + payment.id);
          assert.equal(r.status, 200);
          assert.equal(r.headers.get("cache-control"), "private, no-store");
          const data = await r.json();
          assert.equal(data.balanceDue, 1000);
          assert.equal(data.thisPayment, 500);
          assert.equal(data.totalPaid, 500);
          assert.equal(data.paymentDate, "2026-09-29");
          assert.equal(data.reference, "QA-NO-CHARGE");
          assert.equal(data.status, "PARTIALLY_PAID");
          assert.equal(data.storage_key, undefined);
        },
      );
      await t.test(
        "wrong payment ID and wrong token cannot fetch a receipt",
        async () => {
          assert.equal((await fetch(base + crypto.randomUUID())).status, 404);
          assert.equal(
            (
              await fetch(
                base.replace(token, crypto.randomBytes(24).toString("hex")) +
                  payment.id,
              )
            ).status,
            404,
          );
        },
      );
      await t.test(
        "PDF route returns a private branded PDF attachment",
        async () => {
          const r = await fetch(base + payment.id + "/pdf");
          assert.equal(r.headers.get("content-type"), "application/pdf");
          assert.match(r.headers.get("content-disposition"), /LOLA-Receipt-R-/);
          assert.equal(
            Buffer.from(await r.arrayBuffer())
              .subarray(0, 4)
              .toString(),
            "%PDF",
          );
        },
      );
      await t.test(
        "revoking the invoice token immediately blocks web and PDF receipt",
        async () => {
          await query(
            "UPDATE invoices SET token_revoked_at=now() WHERE id=$1",
            [invoice.id],
          );
          assert.equal((await fetch(base + payment.id)).status, 404);
          assert.equal((await fetch(base + payment.id + "/pdf")).status, 404);
        },
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    }
  },
);
