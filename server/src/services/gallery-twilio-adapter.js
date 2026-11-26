import twilio from "twilio";
import { AppError } from "../utils/errors.js";
export function galleryTwilioClient(config = process.env) {
  if (
    !/^AC[0-9a-f]{32}$/i.test(config.TWILIO_ACCOUNT_SID || "") ||
    !/^SK[0-9a-f]{32}$/i.test(config.TWILIO_API_KEY_SID || "") ||
    !config.TWILIO_API_KEY_SECRET
  )
    throw new AppError(
      "Configure the server-side Twilio account and API key.",
      409,
      "TWILIO_NOT_CONFIGURED",
    );
  return twilio(config.TWILIO_API_KEY_SID, config.TWILIO_API_KEY_SECRET, {
    accountSid: config.TWILIO_ACCOUNT_SID,
    autoRetry: false,
    maxRetries: 0,
    timeout: 15000,
  });
}
// Deliberately no live create() entry point in this staging release. Messaging Services
// cannot be exercised with Twilio test credentials; local simulation has no network transport.
export async function fetchGalleryMessage(sid) {
  if (!/^SM[0-9a-f]{32}$/i.test(sid))
    throw new AppError(
      "Invalid provider message.",
      422,
      "TWILIO_MESSAGE_INVALID",
    );
  return galleryTwilioClient().messages(sid).fetch();
}

// Implemented for a separately approved future production release. Staging always
// exits before constructing a client, even if live credentials/flags are present.
export async function submitApprovedGallerySms(
  { to, body },
  config = process.env,
  { clientFactory = galleryTwilioClient } = {},
) {
  if (config.APP_ENV !== "production") return { simulated: true };
  if (
    config.GALLERY_SMS_LIVE_ENABLED !== "true" ||
    config.TWILIO_SENDER_REGISTRATION_REVIEWED !== "true" ||
    !config.TWILIO_SENDER_REGISTRATION_EVIDENCE ||
    !/^MG[0-9a-f]{32}$/i.test(config.TWILIO_MESSAGING_SERVICE_SID || "")
  )
    throw new AppError(
      "Live Gallery SMS requires a separately approved release and verified sending-program configuration.",
      409,
      "GALLERY_SMS_LIVE_NOT_APPROVED",
    );
  if (
    !/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(to) ||
    typeof body !== "string" ||
    body.length > 1600
  )
    throw new AppError(
      "Reviewed Gallery message is invalid.",
      422,
      "GALLERY_SMS_MESSAGE_INVALID",
    );
  const message = await clientFactory(config).messages.create({
    to,
    body,
    messagingServiceSid: config.TWILIO_MESSAGING_SERVICE_SID,
    statusCallback: "https://api.thelolabooth.com/api/gallery-twilio/status",
    shortenUrls: false,
  });
  return { simulated: false, sid: message.sid, status: message.status };
}
