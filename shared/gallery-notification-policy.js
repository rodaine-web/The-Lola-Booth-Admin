// Rates are integer microdollars to avoid floating-point budget drift.
const GSM = new Set(
  Array.from(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ),
);
const EXT = new Set(Array.from("^{}\\[~]|€\f"));
export function smsSegments(body) {
  let units = 0,
    gsm = true;
  for (const char of body) {
    if (GSM.has(char)) units++;
    else if (EXT.has(char)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (!gsm) units = body.length; // UTF-16 code units, including both halves of emoji.
  const single = gsm ? 160 : 70,
    multi = gsm ? 153 : 67;
  return {
    encoding: gsm ? "GSM-7" : "UCS-2",
    units,
    segments: units ? (units <= single ? 1 : Math.ceil(units / multi)) : 0,
  };
}
export function usMobile(value) {
  const n = String(value || "").replace(/[\s().-]/g, "");
  const p = /^\d{10}$/.test(n) ? "+1" + n : /^1\d{10}$/.test(n) ? "+" + n : n;
  return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(p) ? p : null;
}
export const defaultNotificationSettings = {
  enabled: false,
  monthlyBudgetMicros: 50000000,
  galleryLimitMicros: 10000000,
  warningMicros: 5000000,
  maxRecipients: 500,
  maxSegments: 3,
  baseMicros: null,
  carrierMicros: null,
  feeMicros: null,
  pricingEvidence: "",
  template:
    "Your photos from The Lola Booth are ready! View your memories: {{secure_photo_link}} Reply STOP to opt out. Reply HELP for help.",
};
export function validateNotificationSettings(input) {
  const s = { ...defaultNotificationSettings, ...input };
  for (const k of [
    "monthlyBudgetMicros",
    "galleryLimitMicros",
    "warningMicros",
    "maxRecipients",
    "maxSegments",
  ])
    if (!Number.isSafeInteger(s[k]) || s[k] < 0)
      throw Error("Enter non-negative whole-number limits.");
  for (const k of ["baseMicros", "carrierMicros", "feeMicros"])
    if (s[k] !== null && (!Number.isSafeInteger(s[k]) || s[k] < 0))
      throw Error("Rates must be non-negative integer microdollars.");
  if (
    s.monthlyBudgetMicros > 1000000000 ||
    s.galleryLimitMicros > 1000000000 ||
    s.maxRecipients > 10000 ||
    s.maxSegments > 10
  )
    throw Error("The configured safety limit is too large.");
  if (
    typeof s.enabled !== "boolean" ||
    typeof s.template !== "string" ||
    s.template.length > 1600 ||
    s.template.split("{{secure_photo_link}}").length !== 2 ||
    /\{\{(?!secure_photo_link\}\})/.test(s.template) ||
    /https?:\/\//i.test(s.template) ||
    !s.template.includes("The Lola Booth") ||
    !s.template.includes("STOP") ||
    !s.template.includes("HELP")
  )
    throw Error(
      "Use one secure_photo_link placeholder, The Lola Booth identification and STOP/HELP instructions. Additional URLs are not supported.",
    );
  if (typeof s.pricingEvidence !== "string" || s.pricingEvidence.length > 1000)
    throw Error("Pricing evidence is too long.");
  return s;
}
export function estimateMessage(template, link, settings) {
  const body = template.replace("{{secure_photo_link}}", link),
    seg = smsSegments(body);
  const priced =
    ["baseMicros", "carrierMicros", "feeMicros"].every(
      (k) => Number.isSafeInteger(settings[k]) && settings[k] >= 0,
    ) && Boolean(settings.pricingEvidence?.trim());
  return {
    ...seg,
    body,
    costMicros: priced
      ? seg.segments *
        (settings.baseMicros + settings.carrierMicros + settings.feeMicros)
      : null,
  };
}
export function nextDeliveryState(current, incoming) {
  const state = String(incoming || "").toUpperCase();
  if (
    ![
      "QUEUED",
      "SENDING",
      "SENT",
      "DELIVERED",
      "UNDELIVERED",
      "FAILED",
    ].includes(state)
  )
    return current;
  if (["DELIVERED", "FAILED", "UNDELIVERED"].includes(current)) return current;
  const rank = { UNKNOWN: 0, SUBMITTING: 0, QUEUED: 1, SENDING: 2, SENT: 3 };
  return (rank[state] ?? 4) >= (rank[current] ?? 0) ? state : current;
}
