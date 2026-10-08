import express from 'express';
import rateLimit from 'express-rate-limit';
import {receiveExternalWebhook,validateMailchimpSecret} from '../services/external-webhooks-service.js';
import { Router } from "express";
import { asyncHandler } from "../utils/async-handler.js";
import { env } from "../config/env.js";
import { handlePaypalWebhook, handleStripeWebhook } from "../services/payment-service.js";
import { processProviderWebhook } from "../services/social-lead-service.js";

export const webhookRouter = Router();
const socialLimit=rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-7',legacyHeaders:false});

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

webhookRouter.post("/meta", socialLimit, asyncHandler(async (req, res) => {
  res.json(await receiveExternalWebhook("META", req.body, req.headers));
}));

webhookRouter.post("/tiktok", socialLimit, asyncHandler(async (req, res) => {
  res.json(await receiveExternalWebhook("TIKTOK", req.body, req.headers));
}));

webhookRouter.post("/linkedin", asyncHandler(async (req, res) => {
  res.json(await processProviderWebhook({ provider: "LINKEDIN", payload: req.body, headers: req.headers }));
}));

webhookRouter.get("/mailchimp",socialLimit,asyncHandler(async(req,res)=>{await validateMailchimpSecret(req.query.key);res.sendStatus(200);}));
webhookRouter.post("/mailchimp",socialLimit,express.raw({type:"application/x-www-form-urlencoded",limit:"1mb"}),asyncHandler(async(req,res)=>res.json(await receiveExternalWebhook("MAILCHIMP",req.body,req.headers,req.query))));
