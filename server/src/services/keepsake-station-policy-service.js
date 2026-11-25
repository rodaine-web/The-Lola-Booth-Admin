import crypto from 'node:crypto';
import {z} from 'zod';
import {query,transaction} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
import {writeAudit} from './audit-service.js';
import {assertKeepsakesManager} from './keepsakes-admin-service.js';
import {DEFAULT_STATION_POLICY,quoteCelebrationStation,stationEligibility} from '../../../shared/keepsake-station-policy.js';
import {KEEPSAKES_CORE_PRODUCTS} from '../../../shared/keepsakes-core-catalogue.js';
const cents=z.number().int().min(0).max(10000000),quantity=z.number().int().positive().max(1000000);
const complimentary=z.object({keychain:z.number().int().min(0),magnet:z.number().int().min(0)}).strict();
const pkg=z.object({hours:z.number().positive().max(168),stationCents:cents,complimentary:quantity,minimumPaid:quantity,complimentaryChoices:z.array(complimentary).min(1).max(3)}).strict();
const paid=z.object({min:quantity,keychain:cents,magnet:cents}).strict(),optional=z.object({min:quantity,'jacketed-print':cents.nullable(),'framed-photo':cents.nullable(),'acrylic-display':cents.nullable(),postcard:cents.nullable()}).strict();
const configSchema=z.object({packages:z.object({ESSENTIAL:pkg,SIGNATURE:pkg,LUXE:pkg}).strict(),paidTiers:z.array(paid).min(1).max(20),optionalTiers:z.array(optional).min(1).max(20)}).strict();
export async function stationPolicyAdmin(user){assertKeepsakesManager(user);const row=(await query('SELECT * FROM keepsake_station_policies ORDER BY created_at DESC,id DESC LIMIT 1')).rows[0];const published=(await query("SELECT * FROM keepsake_station_policies WHERE status='PUBLISHED' ORDER BY created_at DESC,id DESC LIMIT 1")).rows[0];return {quotePolicy:published?{...published.configuration,version:published.version,status:published.status}:null,policy:row?{...row.configuration,version:row.version,status:row.status}:DEFAULT_STATION_POLICY,products:KEEPSAKES_CORE_PRODUCTS.filter(p=>stationEligibility(p.key).station).map(p=>({...p,eligibility:stationEligibility(p.key)}))};}
export async function saveStationPolicy(input,user){
 assertKeepsakesManager(user);const config=configSchema.parse(input);
 for(const tiers of [config.paidTiers,config.optionalTiers])if(tiers[0].min!==1||tiers.some((t,i)=>i&&t.min<=tiers[i-1].min))throw new AppError('Tiers must start at one and increase without duplicates.',422,'STATION_POLICY_INVALID');
 for(const p of Object.values(config.packages))if(p.complimentaryChoices.some(c=>c.keychain+c.magnet!==p.complimentary))throw new AppError('Complimentary choices must equal the package allowance.',422,'STATION_POLICY_INVALID');
 return transaction(async()=>{const version='station-'+crypto.randomUUID();const row=(await query("INSERT INTO keepsake_station_policies(version,configuration,created_by) VALUES($1,$2,$3) RETURNING id",[version,config,user.id])).rows[0];await writeAudit({req:{user},action:'keepsake_station_policy_drafted',entity:'keepsake_station_policy',entityId:row.id,after:{version,...config}});return {saved:true,version,status:'DRAFT'};});
}
export async function previewStationPolicy(input,user){const {policy}=await stationPolicyAdmin(user);try{return quoteCelebrationStation(input,policy);}catch(e){throw new AppError(e.message,422,'STATION_CONFIGURATION_INVALID');}}
export async function publishStationPolicy(input,user){
 assertKeepsakesManager(user);
 const {version,approval}=z.object({version:z.string().max(100),approval:z.literal('APPROVE_PUBLIC_STATION_RATES')}).strict().parse(input);
 return transaction(async()=>{
  await query("SELECT pg_advisory_xact_lock(hashtext('keepsake-station-publication'))");
  const row=(await query("SELECT * FROM keepsake_station_policies WHERE version=$1 AND status='DRAFT' FOR UPDATE",[version])).rows[0];
  if(!row)throw new AppError('Save and review the current draft before publishing.',409,'STATION_POLICY_CHANGED');
  await query("UPDATE keepsake_station_policies SET status='RETIRED' WHERE status='PUBLISHED'");
  await query("UPDATE keepsake_station_policies SET status='PUBLISHED',published_at=now(),published_by=$2 WHERE id=$1",[row.id,user.id]);
  await writeAudit({req:{user},action:'keepsake_station_policy_published',entity:'keepsake_station_policy',entityId:row.id,after:{version,approval}});
  return {published:true,version};
 });
}
