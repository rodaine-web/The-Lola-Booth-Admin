import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../server/src/services/proposal-service.js", import.meta.url), "utf8");
const helperSource = source.slice(
  source.indexOf("async function ensureProposalLead"),
  source.indexOf("async function syncLeadProposalStage")
);

class TestAppError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function buildHarness({ customer, event, existingLead = null }) {
  const calls = [];
  const client = {
    async query(sql, args) {
      calls.push({ sql, args });
      if (sql.includes("FROM clients")) return { rows: customer ? [customer] : [] };
      if (sql.includes("FROM events")) return { rows: event ? [event] : [] };
      if (sql.includes("FROM leads")) return { rows: existingLead ? [existingLead] : [] };
      if (sql.includes("INSERT INTO leads")) return { rows: [{ id: "lead-created" }] };
      return { rows: [] };
    }
  };
  const ensureProposalLead = new Function(
    "AppError",
    "notFound",
    `${helperSource}; return ensureProposalLead;`
  )(TestAppError, (name) => new TestAppError(`${name} not found`, 404, "NOT_FOUND"));

  return { ensureProposalLead, client, calls };
}

const customer = {
  id: "client-1",
  name: "Taylor Demo",
  email: "taylor@example.com",
  phone: "3125550199"
};

const event = {
  id: "event-1",
  client_id: "client-1",
  event_name: "Taylor Birthday",
  event_type: "Birthday",
  event_date: "2026-11-22",
  start_time: "16:00",
  end_time: "20:00",
  guest_count: 25,
  venue_name: "Test Venue",
  city: "Chicago",
  state: "IL",
  package_id: "package-1",
  experience_id: "experience-1"
};

test("proposal-first workflow reuses the lead already linked to the event", async () => {
  const h = buildHarness({ customer, event, existingLead: { id: "lead-existing" } });
  const result = await h.ensureProposalLead(h.client, { client_id: customer.id, event_id: event.id }, "user-1");
  assert.equal(result.lead_id, "lead-existing");
  assert.equal(h.calls.some(call => call.sql.includes("INSERT INTO leads")), false);
});

test("proposal-first workflow creates a PROPOSAL_DRAFT lead linked to client and event", async () => {
  const h = buildHarness({ customer, event });
  const result = await h.ensureProposalLead(
    h.client,
    { client_id: customer.id, event_id: event.id, package_id: "package-2", experience_id: "experience-2" },
    "user-1"
  );

  assert.equal(result.lead_id, "lead-created");
  const insert = h.calls.find(call => call.sql.includes("INSERT INTO leads"));
  assert.ok(insert);
  assert.match(insert.sql, /'PROPOSAL_DRAFT'/);
  assert.equal(insert.args.at(-2), customer.id);
  assert.equal(insert.args.at(-1), event.id);
  assert.ok(insert.args.includes("package-2"));
  assert.ok(insert.args.includes("experience-2"));
});

test("proposal-first workflow refuses a client/event mismatch", async () => {
  const h = buildHarness({ customer, event: { ...event, client_id: "different-client" } });
  await assert.rejects(
    () => h.ensureProposalLead(h.client, { client_id: customer.id, event_id: event.id }, "user-1"),
    error => error.code === "PROPOSAL_CLIENT_EVENT_MISMATCH"
  );
});

test("proposal-first workflow requires email but allows missing phone", async () => {
  const noEmail = buildHarness({ customer: { ...customer, email: null }, event });
  await assert.rejects(
    () => noEmail.ensureProposalLead(noEmail.client, { client_id: customer.id, event_id: event.id }, "user-1"),
    error => error.code === "CLIENT_EMAIL_REQUIRED"
  );

  const noPhone = buildHarness({ customer: { ...customer, phone: null }, event });
  const result = await noPhone.ensureProposalLead(noPhone.client, { client_id: customer.id, event_id: event.id }, "user-1");
  assert.equal(result.lead_id, "lead-created");
  const insert = noPhone.calls.find(call => call.sql.includes("INSERT INTO leads"));
  assert.ok(insert);
  assert.ok(insert.args.includes(null));
});
