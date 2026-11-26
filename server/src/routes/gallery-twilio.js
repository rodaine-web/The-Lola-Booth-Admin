import express from "express";
import twilio from "twilio";
import { asyncHandler } from "../utils/async-handler.js";
import { AppError } from "../utils/errors.js";
import { galleryTwilioCallback } from "../services/gallery-notification-service.js";
export const galleryTwilioRouter = express.Router();
// Use configured canonical URLs: never trust Host/X-Forwarded-Host for signature validation.
galleryTwilioRouter.use(
  express.urlencoded({ extended: false, limit: "32kb", parameterLimit: 100 }),
);
for (const kind of ["status", "inbound"])
  galleryTwilioRouter.post(
    "/" + kind,
    asyncHandler(async (req, res) => {
      const base =
        process.env.APP_ENV === "staging"
          ? "https://stagingapi.thelolabooth.com"
          : "https://api.thelolabooth.com";
      const url = base + "/api/gallery-twilio/" + kind;
      if (!process.env.TWILIO_AUTH_TOKEN)
        throw new AppError(
          "Twilio webhook validation is not configured.",
          503,
          "TWILIO_NOT_CONFIGURED",
        );
      if (
        req.originalUrl.includes("?") ||
        !twilio.validateRequest(
          process.env.TWILIO_AUTH_TOKEN,
          req.get("X-Twilio-Signature") || "",
          url,
          req.body,
        )
      )
        throw new AppError(
          "Invalid Twilio signature.",
          403,
          "TWILIO_SIGNATURE_INVALID",
        );
      await galleryTwilioCallback(req.body);
      // Advanced Opt-Out owns STOP/HELP replies. Never generate an additional message.
      res.type("text/xml").send("<Response/>");
    }),
  );
