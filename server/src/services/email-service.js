import {stagingEmailPolicy} from '../config/staging-safety.js';
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/errors.js";
import { getStorageProvider } from "./storage-service.js";

const MICROSOFT_TOKEN_SKEW_MS = 60_000;
const MICROSOFT_REQUEST_TIMEOUT_MS = 15_000;
const MICROSOFT_SIMPLE_ATTACHMENT_LIMIT_BYTES = 3 * 1024 * 1024;

export class MicrosoftEmailProvider {
  constructor({
    tenantId,
    clientId,
    clientSecret,
    senderEmail,
    emailFrom,
    fetchImpl = globalThis.fetch,
    storageProvider = getStorageProvider(),
    graphBaseUrl = "https://graph.microsoft.com/v1.0",
    loginBaseUrl = "https://login.microsoftonline.com"
  } = {}) {
    this.tenantId = tenantId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.senderEmail = senderEmail;
    this.emailFrom = emailFrom;
    this.fetchImpl = fetchImpl;
    this.storageProvider = storageProvider;
    this.graphBaseUrl = graphBaseUrl.replace(/\/$/, "");
    this.loginBaseUrl = loginBaseUrl.replace(/\/$/, "");
    this.cachedToken = null;
  }

  validateConfig() {
    const missing = [];
    if (!this.tenantId) missing.push("MICROSOFT_TENANT_ID");
    if (!this.clientId) missing.push("MICROSOFT_CLIENT_ID");
    if (!this.clientSecret) missing.push("MICROSOFT_CLIENT_SECRET");
    if (!this.senderEmail) missing.push("MICROSOFT_SENDER_EMAIL");
    if (!this.fetchImpl) missing.push("fetch");
    if (missing.length) {
      throw new AppError(`Microsoft email provider is missing required configuration: ${missing.join(", ")}`, 500, "EMAIL_PROVIDER_MISCONFIGURED");
    }
  }

  async getAccessToken() {
    this.validateConfig();
    const now = Date.now();
    if (this.cachedToken?.accessToken && this.cachedToken.expiresAt - MICROSOFT_TOKEN_SKEW_MS > now) {
      return this.cachedToken.accessToken;
    }

    const response = await this.fetchWithTimeout(`${this.loginBaseUrl}/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default"
      })
    });

    if (!response.ok) {
      logger.warn({ status: response.status, retryable: isRetryableStatus(response.status) }, "Microsoft Graph token request failed");
      throw new AppError("Email provider authentication failed.", 502, "MICROSOFT_TOKEN_FAILED", {
        provider: "microsoft",
        status: response.status,
        retryable: isRetryableStatus(response.status)
      });
    }

    const payload = await response.json();
    if (!payload.access_token) {
      throw new AppError("Email provider authentication response was invalid.", 502, "MICROSOFT_TOKEN_INVALID");
    }

    const expiresInSeconds = Number(payload.expires_in || 3600);
    this.cachedToken = {
      accessToken: payload.access_token,
      expiresAt: now + expiresInSeconds * 1000
    };
    return payload.access_token;
  }

  async send({ to, cc, bcc, subject, body, html, text, replyTo, attachments = [] }) {
    ({to,cc,bcc,subject}=stagingEmailPolicy({to,cc,bcc,subject}));
    const token = await this.getAccessToken();
    const message = {
      subject,
      body: html
        ? { contentType: "HTML", content: html }
        : { contentType: "Text", content: text || body || "" },
      toRecipients: normalizeRecipients(to),
      ccRecipients: normalizeRecipients(cc),
      bccRecipients: normalizeRecipients(bcc),
      replyTo: normalizeRecipients(replyTo),
      attachments: await this.buildAttachments(attachments)
    };

    if (!message.toRecipients.length) {
      throw new AppError("Email requires at least one recipient.", 400, "EMAIL_RECIPIENT_REQUIRED");
    }

    const response = await this.fetchWithTimeout(`${this.graphBaseUrl}/users/${encodeURIComponent(this.senderEmail)}/sendMail`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ message, saveToSentItems: true })
    });

    if (response.status !== 202) {
      const classification = classifyMicrosoftSendFailure(response.status);
      logger.warn({
        provider: "microsoft",
        status: response.status,
        retryable: classification.retryable,
        outcomeUnknown: response.status===408||response.status>=500,
        retryAfter: response.headers.get("retry-after") || undefined
      }, "Microsoft Graph sendMail request failed");
      throw new AppError(classification.customerMessage, classification.statusCode, classification.code, {
        provider: "microsoft",
        status: response.status,
        retryable: classification.retryable,
        outcomeUnknown: response.status===408||response.status>=500,
        retryAfter: response.headers.get("retry-after") || undefined
      });
    }

    return {
      provider: "microsoft",
      providerMessageId: `msgraph-${Date.now()}`,
      status: "SENT",
      deliveredExternally: true,
      from: this.emailFrom,
      to,
      subject,
      attachments: attachments.map((attachment) => ({ filename: attachment.filename, storageKey: attachment.storageKey }))
    };
  }

  async buildAttachments(attachments) {
    const graphAttachments = [];
    for (const attachment of attachments) {
      const contentBytes = attachment.buffer || await this.storageProvider.get(attachment.storageKey);
      if (contentBytes.length > MICROSOFT_SIMPLE_ATTACHMENT_LIMIT_BYTES) {
        throw new AppError("Email attachment is too large for direct Microsoft Graph delivery.", 413, "MICROSOFT_ATTACHMENT_TOO_LARGE", {
          filename: attachment.filename,
          sizeBytes: contentBytes.length,
          retryable: false
        });
      }
      graphAttachments.push({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: attachment.filename,
        contentType: attachment.mimeType || "application/octet-stream",
        contentBytes: Buffer.from(contentBytes).toString("base64")
      });
    }
    return graphAttachments;
  }

  async fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MICROSOFT_REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
      logger.warn({ provider: "microsoft", error: error.name }, "Microsoft Graph network request failed");
      throw new AppError("Email provider request failed.", 502, "MICROSOFT_NETWORK_ERROR", {
        provider: "microsoft",
        retryable: !url.endsWith("/sendMail"),
        outcomeUnknown: url.endsWith("/sendMail")
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function normalizeRecipients(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : String(value).split(",");
  return values
    .map((address) => String(address).trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

export function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

export function classifyMicrosoftSendFailure(status) {
  if (status === 401) return { code: "MICROSOFT_AUTH_REJECTED", statusCode: 502, retryable: false, customerMessage: "Email provider authentication was rejected." };
  if (status === 403) return { code: "MICROSOFT_SEND_FORBIDDEN", statusCode: 502, retryable: false, customerMessage: "Email provider is not authorized to send from this mailbox." };
  if (status === 404) return { code: "MICROSOFT_MAILBOX_NOT_FOUND", statusCode: 502, retryable: false, customerMessage: "Email sender mailbox was not found." };
  if (status === 429) return { code: "MICROSOFT_RATE_LIMITED", statusCode: 503, retryable: true, customerMessage: "Email provider is temporarily rate limited." };
  if (status >= 500) return { code: "MICROSOFT_TEMPORARY_FAILURE", statusCode: 503, retryable: true, customerMessage: "Email provider is temporarily unavailable." };
  return { code: "MICROSOFT_SEND_FAILED", statusCode: 502, retryable: false, customerMessage: "Email provider rejected the message." };
}

function createProvider() {
  if (env.emailProvider === "microsoft") {
    return new MicrosoftEmailProvider({
      tenantId: env.microsoftTenantId,
      clientId: env.microsoftClientId,
      clientSecret: env.microsoftClientSecret,
      senderEmail: env.microsoftSenderEmail,
      emailFrom: env.emailFrom
    });
  }
  return null;
}

export function getEmailProviderReadiness(config = env, providerOptions = {}) {
  if (!config.emailProvider || config.emailProvider === "development") {
    return {
      provider: "development",
      active: false,
      deliveredExternally: false,
      from: config.emailFrom
    };
  }

  if (config.emailProvider === "microsoft") {
    const provider = new MicrosoftEmailProvider({
      tenantId: config.microsoftTenantId,
      clientId: config.microsoftClientId,
      clientSecret: config.microsoftClientSecret,
      senderEmail: config.microsoftSenderEmail,
      emailFrom: config.emailFrom,
      ...providerOptions
    });
    provider.validateConfig();
    return {
      provider: "microsoft",
      active: true,
      deliveredExternally: true,
      senderEmail: config.microsoftSenderEmail,
      from: config.emailFrom
    };
  }

  throw new AppError(`Email provider ${config.emailProvider} is configured but no adapter is active yet.`, 500, "EMAIL_PROVIDER_UNSUPPORTED");
}

export async function sendEmail({ to, cc, bcc, subject, body, html, text, replyTo, attachments = [] }) {
  ({to,cc,bcc,subject}=stagingEmailPolicy({to,cc,bcc,subject}));
  if (!env.emailProvider || env.emailProvider === "development") {
    return {
      provider: "development",
      providerMessageId: `dev-${Date.now()}`,
      status: "SENT",
      deliveredExternally: false,
      from: env.emailFrom,
      to,
      cc,
      bcc,
      subject,
      body: text || body || html || "",
      attachments: attachments.map((attachment) => ({ filename: attachment.filename, storageKey: attachment.storageKey }))
    };
  }

  const provider = createProvider();
  if (provider) return provider.send({ to, cc, bcc, subject, body, html, text, replyTo, attachments });

  throw new Error(`Email provider ${env.emailProvider} is configured but no adapter is active yet.`);
}
