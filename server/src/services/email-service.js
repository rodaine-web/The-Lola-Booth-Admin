import { env } from "../config/env.js";

export async function sendEmail({ to, subject, body, attachments = [] }) {
  if (!env.emailProvider || env.emailProvider === "development") {
    return {
      provider: "development",
      providerMessageId: `dev-${Date.now()}`,
      status: "SENT",
      deliveredExternally: false,
      from: env.emailFrom,
      to,
      subject,
      body,
      attachments: attachments.map((attachment) => ({ filename: attachment.filename, storageKey: attachment.storageKey }))
    };
  }

  throw new Error(`Email provider ${env.emailProvider} is configured but no adapter is active yet.`);
}
