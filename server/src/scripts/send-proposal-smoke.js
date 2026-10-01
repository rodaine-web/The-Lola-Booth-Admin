import crypto from "node:crypto";
import { query, transaction, pool } from "../db/pool.js";
import { buildProposalSnapshot, getProposal, nextNumber, sendProposal } from "../services/proposal-service.js";

const TARGET = "olawandeadams@gmail.com";
const MARKER = "TEST-PROPOSAL-SMOKE-2026-10-01";

async function run() {
  const existing = await query(
    "SELECT id, proposal_number, status, sent_at FROM proposals WHERE notes=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [MARKER]
  );
  if (existing.rows[0]?.status === "SENT") {
    console.log(JSON.stringify({ smokeTest: "already-sent", ...existing.rows[0] }));
    return;
  }

  const glam = await query(
    "SELECT * FROM experiences WHERE deleted_at IS NULL AND active=true AND (lower(name) LIKE '%glam%' OR lower(slug) LIKE '%glam%') ORDER BY display_order NULLS LAST, created_at LIMIT 1"
  );
  if (!glam.rows[0]) throw new Error("Glam experience not found");

  const owner = await query(
    "SELECT id FROM users WHERE deleted_at IS NULL AND active=true ORDER BY created_at LIMIT 1"
  );
  if (!owner.rows[0]) throw new Error("No active user available for test ownership");

  const testClientEmail = "proposal-test-20261001@thelolabooth.com";
  let client = await query(
    "SELECT * FROM clients WHERE deleted_at IS NULL AND lower(email)=lower($1) LIMIT 1",
    [testClientEmail]
  );
  if (!client.rows[0]) {
    client = await query(
      "INSERT INTO clients (name,email,client_type,referral_source) VALUES ($1,$2,'INDIVIDUAL','SYSTEM_TEST') RETURNING *",
      ["LOLA Proposal Test", testClientEmail]
    );
  }

  const event = await query(
    `INSERT INTO events (event_name,client_id,event_type,event_date,experience_id,status,internal_notes)
     VALUES ($1,$2,'PRIVATE_EVENT',$3,$4,'DRAFT',$5) RETURNING *`,
    ["Proposal System Test", client.rows[0].id, "2026-10-15", glam.rows[0].id, MARKER]
  );

  const input = {
    client_id: client.rows[0].id,
    event_id: event.rows[0].id,
    experience_id: glam.rows[0].id,
    proposal_type: "PRIVATE_EVENT",
    proposal_title: "TEST - LOLA Proposal System",
    proposal_date: new Date().toISOString().slice(0,10),
    notes: MARKER,
    package_amount: 0,
    experience_surcharge: 0,
    discount: 0,
    tax_rate: 0,
    deposit_type: "PERCENTAGE",
    deposit_value: 30,
    selected_experiences: [{
      experience_id: glam.rows[0].id,
      key: "glam",
      name: glam.rows[0].name || "The Glam",
      package_name: "Production Smoke Test",
      price: 1,
      headline: "Clean. Classic. Beautifully you.",
      description: "This is a production smoke test of the LOLA proposal experience."
    }],
    visual_sections: [],
    introduction: "This is a production smoke test of the LOLA proposal system."
  };

  const snapshot = await buildProposalSnapshot(input);

  const proposal = await transaction(async (db) => {
    const proposalNumber = await nextNumber(db, "next_proposal_number", "proposal_prefix", "PROP");
    const inserted = await db.query(
      `INSERT INTO proposals (
        proposal_number, client_id, event_id, owner_user_id, experience_id, secure_token, status, notes,
        total, valid_through, content, pricing_snapshot, line_items_snapshot, document_template_key,
        editable_sections, proposal_source, proposal_title, proposal_date, proposal_type,
        selected_experiences, proposal_visuals, visual_sections
      ) VALUES (
        $1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12,$13,$14,'GENERATED',$15,$16,$17,$18,$19,$20
      ) RETURNING *`,
      [
        proposalNumber,
        client.rows[0].id,
        event.rows[0].id,
        owner.rows[0].id,
        glam.rows[0].id,
        crypto.randomBytes(24).toString("hex"),
        MARKER,
        snapshot.pricing.total,
        snapshot.validThrough,
        JSON.stringify(snapshot.content),
        JSON.stringify(snapshot.pricing),
        JSON.stringify(snapshot.lineItems),
        snapshot.documentTemplateKey,
        JSON.stringify(snapshot.editableSections),
        snapshot.proposalTitle,
        snapshot.proposalDate,
        snapshot.proposalType,
        JSON.stringify(snapshot.selectedExperiences),
        JSON.stringify(snapshot.proposalVisuals),
        JSON.stringify(snapshot.visualSections)
      ]
    );
    return inserted.rows[0];
  });

  const hydrated = await getProposal(proposal.id);
  const result = await sendProposal(
    {
      body: {
        recipient: TARGET,
        subject: "TEST - LOLA Proposal Preview & Email Delivery"
      },
      user: { id: owner.rows[0].id }
    },
    hydrated
  );

  console.log(JSON.stringify({
    smokeTest: "sent",
    proposalId: proposal.id,
    proposalNumber: proposal.proposal_number,
    proposalTotal: snapshot.pricing.total,
    recipient: TARGET,
    provider: result.email?.provider,
    providerMessageId: result.email?.providerMessageId,
    emailStatus: result.email?.status,
    deliveredExternally: result.email?.deliveredExternally
  }));
}

run()
  .catch((error) => {
    console.error("PROPOSAL_SMOKE_TEST_FAILED", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
