import test from "node:test";
import assert from "node:assert/strict";
import {
  formOwnerNotificationsEnabled,
  stagingEmailPolicy,
} from "../server/src/config/staging-safety.js";
const config = {
  APP_ENV: "staging",
  STAGING_EMAIL_ENABLED: "false",
  FORM_OWNER_NOTIFICATIONS_ENABLED: "true",
  FORM_OWNER_NOTIFICATIONS_SINCE: "2035-01-01T00:00:00Z",
};
test("owner-only lane requires explicit enablement and cutoff", () => {
  assert.equal(
    formOwnerNotificationsEnabled({
      ...config,
      FORM_OWNER_NOTIFICATIONS_ENABLED: "false",
    }),
    false,
  );
  assert.equal(
    formOwnerNotificationsEnabled({
      ...config,
      FORM_OWNER_NOTIFICATIONS_SINCE: "",
    }),
    false,
  );
  assert.equal(formOwnerNotificationsEnabled(config), true);
});
test("owner-only lane does not enable customer, CC, BCC, or ordinary messages", () => {
  assert.match(
    stagingEmailPolicy(
      {
        to: "info@thelolabooth.com",
        subject: "Contact",
        formOwnerNotification: true,
      },
      config,
    ).subject,
    /LOLA STAGING FORM/,
  );
  for (const message of [
    { to: "customer@example.invalid", formOwnerNotification: true },
    {
      to: "info@thelolabooth.com",
      cc: "customer@example.invalid",
      formOwnerNotification: true,
    },
    {
      to: "info@thelolabooth.com",
      bcc: "customer@example.invalid",
      formOwnerNotification: true,
    },
    { to: "info@thelolabooth.com" },
  ])
    assert.throws(() => stagingEmailPolicy(message, config));
});
const database = process.env.GALLERY_TEST_DATABASE_URL;
test(
  "paused worker owner lane excludes history and customers; completed messages are not reclaimed",
  { skip: !database },
  async () => {
    const u = new URL(database);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(u.hostname) &&
        u.pathname.endsWith("_qa"),
    );
    Object.assign(process.env, config, {
      DATABASE_URL: database,
      CLIENT_ORIGIN:"https://stagingadmin.thelolabooth.com",PUBLIC_APP_URL:"https://stagingadmin.thelolabooth.com",PUBLIC_BASE_URL:"https://staging.thelolabooth.com",PUBLIC_DOCUMENT_BASE_URL:"https://staging.thelolabooth.com",PUBLIC_INQUIRY_ALLOWED_ORIGINS:"https://staging.thelolabooth.com",
      SMS_PROVIDER:"none",STRIPE_SECRET_KEY:"",GA4_ENABLED:"false",META_EVENTS_ENABLED:"false",TIKTOK_EVENTS_ENABLED:"false",
      NODE_ENV: "test",
      EMAIL_PROVIDER: "development",
    });
    const { query, pool } = await import("../server/src/db/pool.js");
    const { processFormOwnerNotifications } =
      await import("../server/src/services/form-owner-notifications.js");
    const { randomUUID } = await import("node:crypto");
    const ids = [];
    try {
      for (const [recipient, purpose, created, status] of [
        ["info@thelolabooth.com", "owner", "2035-01-02", "SCHEDULED"],
        ["info@thelolabooth.com", "owner", "2034-01-02", "SCHEDULED"],
        ["customer@example.invalid", "customer", "2035-01-02", "SCHEDULED"],
        ["info@thelolabooth.com", "owner", "2035-01-02", "FAILED"],
      ]) {
        const r = await query(
          "INSERT INTO communications(channel,type,direction,recipient,subject,rendered_body,trigger_key,idempotency_key,status,send_mode,scheduled_at,created_at) VALUES('EMAIL','EMAIL','OUTBOUND',$1,'QA NOTIFICATION','Synthetic test','PUBLIC_FORM',$2,$3,'SCHEDULED',now(),$4) RETURNING id",
          [
            recipient,
            `public-form:${randomUUID()}:${purpose}`,
            status,
            created,
          ],
        );
        ids.push(r.rows[0].id);
      }
      const sent = [];
      const sendCommunicationImpl = async (id) => {
        sent.push(id);
        await query(
          "UPDATE communications SET status='SENT_TO_PROVIDER' WHERE id=$1",
          [id],
        );
        return { communication: { status: "SENT_TO_PROVIDER" } };
      };
      await processFormOwnerNotifications({ sendCommunicationImpl });
      await processFormOwnerNotifications({ sendCommunicationImpl });
      assert.deepEqual(sent, [ids[0]]);
    } finally {
      await query("DELETE FROM communications WHERE id=ANY($1::uuid[])", [ids]);
      await pool.end();
    }
  },
);
