import {z} from 'zod';
const copyText=z.string().max(20000);
const media=z.array(z.string().uuid()).max(4);
const highlights=z.array(z.object({icon:z.string().max(20),title:z.string().max(200),body:copyText})).max(18);
const copy=z.object(Object.fromEntries(['intro','event_intro','why_us_title','why_us_intro','close_title','close_body','next_steps_intro','terms_intro','experience_intro_style','investment_title','investment_intro','optional_goal_section','optional_brand_section','tagline','tone'].map(key=>[key,copyText.optional()]))).extend({next_steps:z.array(copyText).max(30).optional(),goals:z.array(copyText).max(30).optional(),why_items:highlights.optional(),media_ids:media.optional()});
const experience=z.object({personal:copyText.optional(),business:copyText.optional(),Wedding:copyText.optional(),Birthday:copyText.optional(),'Private Party':copyText.optional(),'Brand Activation':copyText.optional(),'Corporate Event':copyText.optional(),Other:copyText.optional(),media_ids:media.optional()});
export const scenarioConfigSchema=z.object({global:copy,events:z.record(z.string(),copy),experiences:z.record(z.string(),experience),packages:z.record(z.string(),z.object({description:copyText.optional()}))});
export const scenarioOverridesSchema=z.object({copy:copy.optional(),experiences:z.record(z.string(),z.object({description:copyText.optional(),features:z.array(z.string().max(3000)).max(100).optional()})).optional(),media:z.record(z.string(),media).optional(),optional_sections:z.array(z.object({title:z.string().max(200),body:copyText})).max(16).optional()});
