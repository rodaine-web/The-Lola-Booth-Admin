import { z } from "zod";
const baseInquirySchema = z.object({
  eventName: z.string().trim().max(160).optional(),
  bookingVersion: z.literal(2).optional(),
  selections: z.array(z.object({experienceId:z.string().uuid(),packageId:z.string().uuid(),customNotes:z.string().trim().max(1500).optional()})).min(1).max(4).optional(),
  addons: z.array(z.object({addonId:z.string().uuid(),quantity:z.number().int().min(1).max(24)})).max(40).optional(),
  formKind: z.enum(["CONTACT", "BOOKING"]).optional(),
  submissionId: z.string().uuid().optional(),
  topic: z
    .enum([
      "General inquiry",
      "Request a quote",
      "Partnership opportunity",
      "Corporate / brand collaboration",
      "Vendor / venue partnership",
      "Press or media",
      "Careers / employment",
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
    if(value.bookingVersion===2 && publicFormKind(value)!=='CONTACT'){
      for(const field of ['eventName','eventStartTime','eventEndTime','guestCount','selections','submissionId'])if(!value[field])ctx.addIssue({code:'custom',path:[field],message:'This field is required.'});
      if(value.eventDate && ((!Number.isFinite(new Date(value.eventDate+'T12:00:00Z').getTime()) || new Date(value.eventDate+'T12:00:00Z').toISOString().slice(0,10)!==value.eventDate) || value.eventDate<new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())))ctx.addIssue({code:'custom',path:['eventDate'],message:'Choose a valid future event date.'});
      for(const field of ['eventStartTime','eventEndTime'])if(value[field]&&!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value[field]))ctx.addIssue({code:'custom',path:[field],message:'Choose a valid time.'});
      if(value.eventStartTime===value.eventEndTime)ctx.addIssue({code:'custom',path:['eventEndTime'],message:'Start and end times must differ.'});
      if(value.phone && !/^[+()\d .-]+$/.test(value.phone))ctx.addIssue({code:'custom',path:['phone'],message:'Enter a valid phone number.'});
      if(value.phone && (value.phone.replace(/\D/g,'').length<7 || value.phone.replace(/\D/g,'').length>15))ctx.addIssue({code:'custom',path:['phone'],message:'Enter a valid phone number.'});
      if(value.guestCount>100000)ctx.addIssue({code:'custom',path:['guestCount'],message:'Guest count is too large.'});
    }
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
      eventName,
      bookingVersion,
      selections,
      addons,
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
