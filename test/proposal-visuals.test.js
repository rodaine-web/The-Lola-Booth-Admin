import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  proposalVisualSchema,
  proposalVisualHtml,
  validateProposalVisuals,
} from "../server/src/services/proposal-visual-service.js";
import { proposalEditInput } from "../server/src/services/proposal-edit-input.js";
import {
  generateProposalPdf,
  generatePaymentReceiptPdf,
} from "../server/src/services/document-service.js";
const section = {
  id: crypto.randomUUID(),
  kind: "BOOTH",
  title: "Custom booth",
  body: "Capture modes: photos and GIFs",
  media_ids: [],
};
test("optional visual sections retain ordered structured content through edit hydration", () => {
  const input = {
    visual_sections: [
      section,
      {
        ...section,
        id: crypto.randomUUID(),
        title: "Backdrop",
        kind: "BACKDROP",
      },
    ],
    total: 1500,
    pricing_snapshot: { total: 1500, deposit_amount: 500 },
    line_items_snapshot: [],
  };
  assert.deepEqual(
    proposalEditInput(input).visual_sections,
    input.visual_sections,
  );
  assert.equal(proposalEditInput(input).total, 1500);
  assert.deepEqual(proposalVisualSchema.parse([]), []);
});
test("visual section validation rejects remote URLs, unknown types and excessive assets", () => {
  assert.throws(() =>
    proposalVisualSchema.parse([
      { ...section, media_ids: ["https://example.com/image.jpg"] },
    ]),
  );
  assert.throws(() =>
    proposalVisualSchema.parse([{ ...section, kind: "FACE_MATCH" }]),
  );
  assert.throws(() =>
    proposalVisualSchema.parse([
      {
        ...section,
        media_ids: Array.from({ length: 5 }, () => crypto.randomUUID()),
      },
    ]),
  );
});
test("visual text is escaped and empty proposals do not grow visual markup", () => {
  assert.equal(proposalVisualHtml({ visual_sections: [] }), "");
  const html = proposalVisualHtml({
    visual_sections: [
      {
        ...section,
        title: "<script>alert(1)</script>",
        body: "<img src=x onerror=alert(1)>",
      },
    ],
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;script&gt;/);
});
test("visual and receipt PDFs render valid PDF bytes", async () => {
  const proposal = await generateProposalPdf({
    id: crypto.randomUUID(),
    proposal_number: "QA-VISUAL",
    client_name: "QA Client",
    event_name: "QA Event",
    pricing_snapshot: { total: 1500 },
    visual_sections: [section],
    line_items_snapshot: [],
  });
  assert.equal(proposal.subarray(0, 4).toString(), "%PDF");
  const receipt = await generatePaymentReceiptPdf({
    id: crypto.randomUUID(),
    number: "R-QA",
    invoiceNumber: "QA-100",
    client: "QA Client",
    event: "QA Event",
    eventDate: "2026-11-21",
    paymentDate: "2026-09-30",
    provider: "STRIPE",
    method: "CARD",
    reference: "QA-NO-CHARGE",
    currency: "USD",
    thisPayment: 500,
    invoiceTotal: 1500,
    previouslyPaid: 0,
    totalPaid: 500,
    balanceDue: 1000,
    status: "PARTIALLY_PAID",
  });
  assert.equal(receipt.subarray(0, 4).toString(), "%PDF");
});
