import { sendEmail } from "../services/email-service.js";

const recipient = process.argv[2];

if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
  console.error("Usage: npm run email:test -- recipient@example.com");
  process.exit(1);
}

try {
  const result = await sendEmail({
    to: recipient,
    subject: "LOLA Admin Microsoft 365 email test",
    body: [
      "THE LOLA BOOTH",
      "Good people. Better photos.",
      "",
      "This is a production email provider test from LOLA Admin.",
      "No customer workflow was triggered."
    ].join("\n")
  });
  console.log(JSON.stringify({
    status: result.status,
    provider: result.provider,
    deliveredExternally: result.deliveredExternally,
    to: recipient
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "FAILED",
    code: error.code || "EMAIL_TEST_FAILED",
    message: error.message,
    details: error.details
  }, null, 2));
  process.exit(1);
}
