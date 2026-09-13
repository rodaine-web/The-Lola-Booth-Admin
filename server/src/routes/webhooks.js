import { Router } from "express";
import { asyncHandler } from "../utils/async-handler.js";
import { env } from "../config/env.js";
import { handlePaypalWebhook, handleStripeWebhook } from "../services/payment-service.js";
import { processProviderWebhook } from "../services/social-lead-service.js";

export const webhookRouter = Router();

webhookRouter.post("/stripe", asyncHandler(async (req, res) => {
  res.json(await handleStripeWebhook(req.body, req.headers["stripe-signature"]));
}));

webhookRouter.post("/paypal", asyncHandler(async (req, res) => {
  res.json(await handlePaypalWebhook(req.body));
}));

webhookRouter.get("/meta", asyncHandler(async (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.challenge"] && env.metaWebhookVerifyToken && req.query["hub.verify_token"] === env.metaWebhookVerifyToken) {
    return res.type("text/plain").send(String(req.query["hub.challenge"]));
  }
  res.status(400).json({ error: "Unsupported Meta webhook challenge." });
}));

webhookRouter.post("/meta", asyncHandler(async (req, res) => {
  res.json(await processProviderWebhook({ provider: "META", payload: req.body, headers: req.headers }));
}));

webhookRouter.post("/tiktok", asyncHandler(async (req, res) => {
  res.json(await processProviderWebhook({ provider: "TIKTOK", payload: req.body, headers: req.headers }));
}));

webhookRouter.post("/linkedin", asyncHandler(async (req, res) => {
  res.json(await processProviderWebhook({ provider: "LINKEDIN", payload: req.body, headers: req.headers }));
}));
