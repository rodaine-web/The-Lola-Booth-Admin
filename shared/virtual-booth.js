import {z} from 'zod';
export const virtualDurations={DAY:'24 Hours',THREE_DAYS:'3 Days',WEEK:'1 Week',MONTHLY:'Monthly Subscription'};
export const virtualConfigurationSchema=z.object({
 duration:z.enum(['DAY','THREE_DAYS','WEEK','MONTHLY']),
 participantAllowance:z.number().int().positive().nullable(),activeExperiences:z.number().int().positive().nullable(),customTemplates:z.number().int().nonnegative().nullable(),
 branding:z.string().max(2000),creativeWork:z.string().max(2000),support:z.string().max(2000),usageUnit:z.string().max(100),additionalUsageCents:z.number().int().nonnegative().nullable(),
 setupFeeCents:z.number().int().nonnegative(),minimumMonths:z.number().int().positive(),minimumIsProposed:z.boolean(),
 startDate:z.string().date().nullable(),renewalDate:z.string().date().nullable()
}).strict().refine(v=>!v.startDate||!v.renewalDate||v.renewalDate>v.startDate,{message:'Renewal must follow the start date.'});
