import { z } from "zod";
const baseInquirySchema = z.object({
  formKind: z.enum(["CONTACT", "BOOKING"]).optional(),
  submissionId: z.string().uuid().optional(),
  topic: z
    .enum([
      "General inquiry",
      "Partnership opportunity",
      "Press or media",
      "Existing booking question",
      "Other",
    ])
    .optional(),
  company: z.string().trim().max(160).optional(),
  form_id: z.string().max(80).optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z
    .string()
    .trim()
    .email()
    .max(160)
    .transform((value) => value.toLowerCase()),
  phone: z.string().trim().min(7).max(40).optional(),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  eventStartTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  eventEndTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  eventType: z.string().trim().min(2).max(80).optional(),
  guestCount: z.coerce.number().int().positive().optional(),
  venueName: z.string().trim().max(160).optional(),
  venueAddress: z.string().trim().max(240).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  state: z.string().trim().min(2).max(40).optional(),
  zip: z.string().trim().min(3).max(20).optional(),
  preferredExperienceId: z.string().uuid().optional(),
  preferredPackageId: z.string().uuid().optional(),
  referralSource: z.string().trim().max(120).optional(),
  message: z.string().trim().max(3000).optional(),
  utm_source: z.string().trim().max(120).optional(),
  utm_medium: z.string().trim().max(120).optional(),
  utm_campaign: z.string().trim().max(160).optional(),
  utm_content: z.string().trim().max(160).optional(),
  utm_term: z.string().trim().max(160).optional(),
  landing_page_url: z.string().trim().max(500).optional(),
  referrer_url: z.string().trim().max(500).optional(),
  gclid: z.string().trim().max(200).optional(),
  gbraid: z.string().trim().max(200).optional(),
  wbraid: z.string().trim().max(200).optional(),
  fbclid: z.string().trim().max(200).optional(),
  ttclid: z.string().trim().max(200).optional(),
  ga_client_id: z.string().trim().max(200).optional(),
  ga_session_id: z.string().trim().max(200).optional(),
  marketing_email_opt_in: z.boolean().optional(),
  website: z.string().max(0).optional(),
});

export function publicFormKind(payload = {}) {
  return (
    payload.formKind ||
    (/contact/i.test(payload.form_id || "") ? "CONTACT" : "BOOKING")
  );
}
export const inquirySchema = baseInquirySchema
  .superRefine((value, ctx) => {
    const required =
      publicFormKind(value) === "CONTACT"
        ? (value.formKind === "CONTACT" ? ["topic", "message"] : [])
        : ["phone", "eventDate", "eventType", "city", "state"];
    for (const field of required)
      if (!value[field])
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "This field is required.",
        });
  })
  .transform((value) => {
    if (publicFormKind(value) !== "CONTACT")
      return { ...value, formKind: "BOOKING" };
    const {
      eventDate,
      eventStartTime,
      eventEndTime,
      eventType,
      guestCount,
      venueName,
      venueAddress,
      city,
      state,
      zip,
      preferredExperienceId,
      preferredPackageId,
      ...contact
    } = value;
    return {
      ...contact,
      topic: contact.topic || "General inquiry",
      formKind: "CONTACT",
      form_id: "contact",
      marketing_email_opt_in: false,
    };
  });
