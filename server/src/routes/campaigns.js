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
route('get', '/contacts', 'campaigns.read', () => campaignContacts());
route('post', '/import-contacts', 'campaigns.create', req => importCampaignContacts(req.body));
route('post', '/audience-preview', 'campaigns.read', req => resolveCampaignAudience(campaignSchema.shape.audience_json.parse(req.body)));
route('post', '/', 'campaigns.create', req => saveCampaign(req.body, req));
route('get', '/:id', 'campaigns.read', req => campaignDetail(z.uuid().parse(req.params.id)));
route('delete', '/:id', 'campaigns.edit', req => deleteCampaign(z.uuid().parse(req.params.id), req));
route('patch', '/:id', 'campaigns.edit', req => saveCampaign(req.body, req, z.uuid().parse(req.params.id)));
campaignRouter.post('/:id/interests/:interestId/convert', requirePermission('campaigns.read'), requirePermission('write:sales'), asyncHandler(async (req, res) => res.json(await convertCampaignInterest(z.uuid().parse(req.params.id), z.uuid().parse(req.params.interestId), req))));
route('post', '/:id/duplicate', 'campaigns.create', req => duplicateCampaign(z.uuid().parse(req.params.id), req));
route('post', '/:id/preview', 'campaigns.read', async req => renderCampaignEmail(await getCampaign(z.uuid().parse(req.params.id)), req.body.sample || {
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
