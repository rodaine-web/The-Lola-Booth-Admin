import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const database = process.env.GALLERY_TEST_DATABASE_URL;
test(
  "public contact and booking persist distinct requests with one owner notification per submission",
  { skip: !database },
  async () => {
    const url = new URL(database);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname.endsWith("_qa"),
    );
    Object.assign(process.env, {
      DATABASE_URL: database,
      APP_ENV: "test",
      NODE_ENV: "test",
      EMAIL_PROVIDER: "development",
      FORM_NOTIFICATION_EMAIL: "info@thelolabooth.com",
    });
    const { query, pool } = await import("../server/src/db/pool.js");
    const { default: express } = await import("express");
    const { publicRouter } = await import("../server/src/routes/public.js");
    const { errorHandler } =
      await import("../server/src/middleware/error-handler.js");
    const app = express();
    app.use(express.json());
    app.use("/api/public", publicRouter);
    app.use(errorHandler);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const submit = (payload) =>
      fetch(`http://127.0.0.1:${server.address().port}/api/public/inquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    try {
      const marker = crypto.randomUUID();
      const common = {
        firstName: "FORMS QA",
        lastName: marker,
        email: `qa-${marker}@example.invalid`,
      };
      const contact = {
        ...common,
        submissionId: crypto.randomUUID(),
        formKind: "CONTACT",
        topic: "Partnership opportunity",
        message: "Synthetic venue partnership question.",
      };
      let response = await submit(contact);
      assert.equal(
        response.status,
        201,
        JSON.stringify(await response.clone().json()),
      );
      assert.match((await response.json()).message, /message was received/);
      response = await submit(contact);
      assert.equal(response.status, 201);
      assert.equal((await response.json()).inquiryStatus, "IDEMPOTENT_REPLAY");
      response = await submit({
        ...contact,
        submissionId: crypto.randomUUID(),
      });
      assert.equal(response.status, 201);
      response = await submit({
        ...common,
        submissionId: crypto.randomUUID(),
        formKind: "BOOKING",
        form_id: "booking",
        phone: "555-010-0100",
        eventDate: "2027-10-10",
        eventType: "Wedding",
        city: "Chicago",
        state: "IL",
      });
      assert.equal(
        response.status,
        201,
        JSON.stringify(await response.clone().json()),
      );
      assert.match((await response.json()).message, /not reserved/);
      const leads = (
        await query("SELECT * FROM leads WHERE email=$1", [common.email])
      ).rows;
      assert.equal(leads.length, 3);
      assert.equal(
        leads.filter(
          (l) => l.source_subtype === "CONTACT" && l.event_date === null,
        ).length,
        2,
      );
      const messages = (
        await query(
          "SELECT * FROM communications WHERE lead_id=ANY($1::uuid[])",
          [leads.map((l) => l.id)],
        )
      ).rows;
      assert.equal(
        messages.filter((m) => m.recipient === "info@thelolabooth.com").length,
        3,
      );
      assert.equal(messages.length, 6);
      for (const lead of leads) {
        const owner = messages.find(
          (m) =>
            m.lead_id === lead.id && m.recipient === "info@thelolabooth.com",
        );
        assert.equal(owner.status, "SCHEDULED");
        if (lead.source_subtype === "CONTACT")
          assert.doesNotMatch(owner.rendered_body, /Event date|TBD/);
      }
    } finally {
      await new Promise((r) => server.close(r));
      await pool.end();
    }
  },
);
