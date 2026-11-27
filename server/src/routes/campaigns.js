import * as eventPhotos from '../services/event-photo-campaign-service.js';
import {proposalCampaignCatalog,campaignEmailContent} from '../services/campaign-offers.js';
import {campaignDepositInvoice,campaignCommercialProposal} from '../services/campaign-sales-service.js';
import {campaignSenders} from '../services/email-service.js';
import {recordCampaignTracking,transparentPixel} from '../services/campaign-tracking.js';
import { importCampaignContacts } from '../services/campaign-contact-import.js';
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { deleteCampaign, campaignSchema, getCampaign, listCampaigns, campaignContacts, resolveCampaignAudience, saveCampaign, duplicateCampaign, campaignDetail, queueCampaign, campaignAction, campaignTestSend, publicCampaign, submitCampaignInterest, unsubscribeCampaign, convertCampaignInterest, campaignPreference } from '../services/campaign-service.js';
import { renderCampaignEmail } from '../services/campaign-email.js';
export const campaignRouter = Router();
const route = (method, path, permission, fn) => campaignRouter[method](path, requirePermission(permission), asyncHandler(async (req, res) => res.json(await fn(req))));
route('get', '/', 'campaigns.read', req => listCampaigns(req.query));
route('get', '/senders', 'campaigns.read', () => campaignSenders());
route('get', '/contacts', 'campaigns.read', req => campaignContacts(req.user));
route('post', '/import-contacts', 'campaigns.create', req => importCampaignContacts(req.body));
route('post', '/audience-preview', 'campaigns.read', req => resolveCampaignAudience(campaignSchema.shape.audience_json.parse(req.body),req.user));
route('post', '/', 'campaigns.create', req => saveCampaign(req.body, req));
route('get','/offers-for-proposals','write:sales',()=>proposalCampaignCatalog());
campaignRouter.post('/:id/interests/:interestId/proposal',requirePermission('campaigns.read'),requirePermission('write:sales'),asyncHandler(async(req,res)=>res.json(await campaignCommercialProposal(z.uuid().parse(req.params.id),z.uuid().parse(req.params.interestId),req))));
route('post','/:id/interests/:interestId/invoice','write:finance',req=>campaignDepositInvoice(z.uuid().parse(req.params.id),z.uuid().parse(req.params.interestId),req.body,req));
campaignRouter.use('/event-photos',requirePermission('read:events'));
campaignRouter.use('/event-photos', (req,res,next)=>req.method==='GET'?next():requirePermission('write:operations')(req,res,next));
for(const path of ['/event-photos/:eventId/authorize','/event-photos/:eventId/review','/event-photos/:eventId/reviews/:reviewId/decision'])campaignRouter.post(path,requirePermission('write:integrations'));
route('get','/event-photos/options','campaigns.read',req=>eventPhotos.eventPhotoOptions(req.user));
route('get','/event-photos/:eventId','campaigns.read',req=>eventPhotos.eventPhotoAudience(z.uuid().parse(req.params.eventId),req.user));
route('post','/event-photos/:eventId/import','campaigns.create',req=>eventPhotos.importEventPhotoFile(z.uuid().parse(req.params.eventId),req.body,req.user));
route('post','/event-photos/:eventId/authorize','campaigns.send',req=>eventPhotos.authorizeEventPhotoDelivery(z.uuid().parse(req.params.eventId),req.body,req.user));
route('post','/event-photos/:eventId/review','campaigns.send',req=>eventPhotos.reviewEventPhotoCampaign(z.uuid().parse(req.params.eventId),req.body,req.user));
route('post','/event-photos/:eventId/reviews/:reviewId/decision','campaigns.send',req=>eventPhotos.decideEventPhotoCampaign(z.uuid().parse(req.params.eventId),z.uuid().parse(req.params.reviewId),req.body,req.user));
route('get', '/:id', 'campaigns.read', req => campaignDetail(z.uuid().parse(req.params.id)));
route('delete', '/:id', 'campaigns.edit', req => deleteCampaign(z.uuid().parse(req.params.id), req));
route('patch', '/:id', 'campaigns.edit', req => saveCampaign(req.body, req, z.uuid().parse(req.params.id)));
campaignRouter.post('/:id/interests/:interestId/convert', requirePermission('campaigns.read'), requirePermission('write:sales'), asyncHandler(async (req, res) => res.json(await convertCampaignInterest(z.uuid().parse(req.params.id), z.uuid().parse(req.params.interestId), req))));
route('post', '/:id/duplicate', 'campaigns.create', req => duplicateCampaign(z.uuid().parse(req.params.id), req));
route('post', '/:id/preview', 'campaigns.read', async req => renderCampaignEmail(await campaignEmailContent(await getCampaign(z.uuid().parse(req.params.id))), req.body.sample || {
  first_name: 'Jordan',
  company: 'Northstar Group'
}, {
  test: true
}));
route('post', '/:id/test', 'campaigns.send', req => campaignTestSend(z.uuid().parse(req.params.id), req.body.email, req, req.body.sample));
route('post', '/:id/send', 'campaigns.send', req => queueCampaign(z.uuid().parse(req.params.id), req));
route('post', '/:id/schedule', 'campaigns.schedule', req => queueCampaign(z.uuid().parse(req.params.id), req, {
  scheduled_at: z.iso.datetime({
    offset: true
  }).parse(req.body.scheduled_at)
}));
for (const action of ['pause', 'resume', 'retry', 'cancel', 'archive', 'ready']) route('post', '/:id/' + action, ['resume', 'retry'].includes(action) ? 'campaigns.send' : action === 'ready' || action === 'archive' ? 'campaigns.edit' : 'campaigns.cancel', req => campaignAction(z.uuid().parse(req.params.id), action, req));
export const campaignPublicRouter = Router();
campaignPublicRouter.get('/campaigns/interest/:token', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await publicCampaign(req.params.token));
}));
campaignPublicRouter.post('/campaigns/interest/:token', asyncHandler(async (req, res) => res.json(await submitCampaignInterest(req.params.token, req.body))));
campaignPublicRouter.get('/campaigns/unsubscribe/:token', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await campaignPreference(req.params.token));
}));
campaignPublicRouter.post('/campaigns/unsubscribe/:token', asyncHandler(async (req, res) => res.json(await unsubscribeCampaign(req.params.token))));

const trackingRequest=req=>({fetchMode:req.get('sec-fetch-mode')||'',fetchUser:req.get('sec-fetch-user')||'',method:req.method,userAgent:req.get('user-agent')||'',purpose:[req.get('purpose'),req.get('sec-purpose'),req.get('x-purpose')].filter(Boolean).join(' ')});
function trackingHeaders(res){res.set({'Cache-Control':'no-store, max-age=0','Pragma':'no-cache','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'cross-origin'});}
campaignPublicRouter.get('/campaigns/track/open/:token',asyncHandler(async(req,res)=>{
 trackingHeaders(res);
 try{await recordCampaignTracking(req.params.token,'OPEN',trackingRequest(req));}catch(error){if(error.code!=='NOT_FOUND')throw error;}
 res.type('gif').send(transparentPixel);
}));
campaignPublicRouter.get('/campaigns/track/click/:token',asyncHandler(async(req,res)=>{
 trackingHeaders(res);
 const destination=await recordCampaignTracking(req.params.token,'CLICK',trackingRequest(req));
 res.redirect(302,destination);
}));
