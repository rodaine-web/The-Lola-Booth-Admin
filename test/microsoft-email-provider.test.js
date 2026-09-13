import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { MicrosoftEmailProvider, classifyMicrosoftSendFailure, isRetryableStatus } from "../server/src/services/email-service.js";

const automationSource = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../server/src/services/automation-service.js", import.meta.url), "utf8"));

function response(status, payload = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => key.toLowerCase() === "retry-after" ? payload.retryAfter || null : null },
    json: async () => payload
  };
}

function providerWithFetch(fetchImpl, overrides = {}) {
  return new MicrosoftEmailProvider({
    tenantId: "tenant-id",
    clientId: "client-id",
    clientSecret: "client-secret",
    senderEmail: "hello@thelolabooth.com",
    emailFrom: "LOLA Booths <hello@thelolabooth.com>",
    fetchImpl,
    storageProvider: { get: async () => Buffer.from("stored attachment") },
    ...overrides
  });
}

test("Microsoft provider requests an app-only Graph token and caches it", async () => {
  const calls = [];
  const provider = providerWithFetch(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return response(200, { access_token: "token-1", expires_in: 3600 });
    return response(202);
  });

  await provider.send({ to: "client@example.com", subject: "Hello", body: "Text body" });
  await provider.send({ to: "client@example.com", subject: "Hello again", body: "Text body" });

  const tokenCalls = calls.filter((call) => call.url.includes("/oauth2/v2.0/token"));
  const sendCalls = calls.filter((call) => call.url.includes("/sendMail"));
  assert.equal(tokenCalls.length, 1);
  assert.equal(sendCalls.length, 2);
  assert.match(String(tokenCalls[0].options.body), /grant_type=client_credentials/);
  assert.match(String(tokenCalls[0].options.body), /scope=https%3A%2F%2Fgraph\.microsoft\.com%2F\.default/);
});

test("Microsoft provider treats Graph 202 sendMail as successful acceptance", async () => {
  const provider = providerWithFetch(async (url) => url.includes("/token")
    ? response(200, { access_token: "token-1", expires_in: 3600 })
    : response(202));

  const result = await provider.send({ to: "client@example.com", subject: "Accepted", body: "Text body" });

  assert.equal(result.provider, "microsoft");
  assert.equal(result.status, "SENT");
  assert.equal(result.deliveredExternally, true);
});

test("Microsoft provider sends cc, bcc, reply-to, HTML, and file attachments", async () => {
  const calls = [];
  const provider = providerWithFetch(async (url, options) => {
    calls.push({ url, options });
    return url.includes("/token") ? response(200, { access_token: "token-1", expires_in: 3600 }) : response(202);
  });

  await provider.send({
    to: "client@example.com",
    cc: "planner@example.com",
    bcc: ["archive@example.com"],
    replyTo: "hello@thelolabooth.com",
    subject: "Documents",
    html: "<p>Your proposal is ready.</p>",
    attachments: [{ filename: "proposal.pdf", mimeType: "application/pdf", storageKey: "proposal.pdf" }]
  });

  const sendCall = calls.find((call) => call.url.includes("/sendMail"));
  const payload = JSON.parse(sendCall.options.body);
  assert.equal(payload.saveToSentItems, true);
  assert.equal(payload.message.body.contentType, "HTML");
  assert.equal(payload.message.toRecipients[0].emailAddress.address, "client@example.com");
  assert.equal(payload.message.ccRecipients[0].emailAddress.address, "planner@example.com");
  assert.equal(payload.message.bccRecipients[0].emailAddress.address, "archive@example.com");
  assert.equal(payload.message.replyTo[0].emailAddress.address, "hello@thelolabooth.com");
  assert.equal(payload.message.attachments[0].name, "proposal.pdf");
  assert.equal(payload.message.attachments[0].contentBytes, Buffer.from("stored attachment").toString("base64"));
});

test("Microsoft provider reports token failures without exposing token details", async () => {
  const provider = providerWithFetch(async () => response(401, { error: "invalid_client", access_token: "secret" }));

  await assert.rejects(
    () => provider.send({ to: "client@example.com", subject: "Hello", body: "Text body" }),
    (error) => error.code === "MICROSOFT_TOKEN_FAILED" && error.details.status === 401
  );
});

test("Microsoft send failure classification separates permanent and transient failures", () => {
  assert.equal(classifyMicrosoftSendFailure(403).code, "MICROSOFT_SEND_FORBIDDEN");
  assert.equal(classifyMicrosoftSendFailure(403).retryable, false);
  assert.equal(classifyMicrosoftSendFailure(429).retryable, true);
  assert.equal(classifyMicrosoftSendFailure(500).retryable, true);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(400), false);
});

test("Microsoft provider surfaces 403, 429, and 500 send errors", async () => {
  for (const [status, code] of [[403, "MICROSOFT_SEND_FORBIDDEN"], [429, "MICROSOFT_RATE_LIMITED"], [500, "MICROSOFT_TEMPORARY_FAILURE"]]) {
    const provider = providerWithFetch(async (url) => url.includes("/token")
      ? response(200, { access_token: "token-1", expires_in: 3600 })
      : response(status, { retryAfter: "30" }));

    await assert.rejects(
      () => provider.send({ to: "client@example.com", subject: "Hello", body: "Text body" }),
      (error) => error.code === code && error.details.status === status
    );
  }
});

test("Microsoft provider validates required provider configuration", async () => {
  const provider = providerWithFetch(async () => response(202), { clientSecret: "" });

  await assert.rejects(
    () => provider.send({ to: "client@example.com", subject: "Hello", body: "Text body" }),
    (error) => error.code === "EMAIL_PROVIDER_MISCONFIGURED" && error.message.includes("MICROSOFT_CLIENT_SECRET")
  );
});

test("env check requires Microsoft settings only when EMAIL_PROVIDER=microsoft", () => {
  const result = spawnSync(process.execPath, ["server/src/config/env-check.js"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgres://postgres:postgres@localhost:5432/lola_admin",
      JWT_SECRET: "x".repeat(40),
      INTEGRATION_SECRET_KEY: "y".repeat(40),
      CLIENT_ORIGIN: "https://admin.thelolabooth.com",
      PUBLIC_BASE_URL: "https://thelolabooth.com",
      PUBLIC_APP_URL: "https://thelolabooth.com",
      EMAIL_PROVIDER: "microsoft",
      MICROSOFT_TENANT_ID: "",
      MICROSOFT_CLIENT_ID: "",
      MICROSOFT_CLIENT_SECRET: "",
      MICROSOFT_SENDER_EMAIL: ""
    }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /MICROSOFT_TENANT_ID/);
});

test("automation retries can honor Microsoft transient/permanent classification", () => {
  assert.match(automationSource, /error\.details\?\.retryable !== false/);
  assert.match(automationSource, /error\.details\?\.retryAfter/);
});
