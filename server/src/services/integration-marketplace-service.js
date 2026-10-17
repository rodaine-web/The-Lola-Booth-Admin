import definitions from '../../../shared/integration-marketplace-catalog.json' with {type:'json'};
import {marketplaceState,marketplaceMetrics} from '../../../shared/integration-marketplace.js';
import {integrationCatalog} from './integration-catalog-service.js';
import {externalConnections} from './external-connections-service.js';
import {outlookStatus} from './crm-outlook-service.js';
import {query} from '../db/pool.js';
import {AppError} from '../utils/errors.js';
export function marketplaceDays(value){const days=Number(value??30);if(![7,30,90,365].includes(days))throw new AppError('Select 7, 30, 90 or 365 days.',422,'INVALID_DATE_RANGE');return days;}
export async function integrationMarketplace(input={}){
 const days=marketplaceDays(input.days);
 const [catalog,external,mailbox,verified,leads,webhooks,jobs,audit]=await Promise.all([
 integrationCatalog(),externalConnections(),outlookStatus(),
 query("SELECT provider,max(created_at) AS last_success FROM payments WHERE status='SUCCEEDED' AND provider='STRIPE' AND provider_payment_id IS NOT NULL AND deleted_at IS NULL GROUP BY provider"),
 query(`SELECT CASE WHEN upper(lead_source) IN('WEB','WEBSITE','WEBSITE_FORM','PUBLIC_FORM') THEN 'WEBSITE' ELSE upper(lead_source) END AS provider,count(*)::int AS count FROM leads WHERE deleted_at IS NULL AND created_at>=now()-$1::int*interval '1 day' GROUP BY 1`,[days]),
 query("SELECT id,provider,event_type AS operation,status,received_at AS occurred_at FROM webhook_events ORDER BY received_at DESC LIMIT 30"),
 query("SELECT id,provider,event_name AS operation,status,COALESCE(completed_at,started_at,created_at) AS occurred_at,mode FROM integration_jobs ORDER BY created_at DESC LIMIT 30"),
 query("SELECT id,action AS operation,entity,created_at AS occurred_at FROM audit_logs WHERE deleted_at IS NULL AND (entity='integration_connection' OR action LIKE 'outlook_%' OR action LIKE 'integration_%') ORDER BY created_at DESC LIMIT 20")]);
 const apps=definitions.map(def=>{
  const base=catalog.data.find(c=>c.provider===def.id),ext=external.find(c=>c.provider===def.id);
  let evidence={status:base?.status,verified:false,lastSuccess:base?.lastSuccess,mode:base?.mode,config:base?.config,testAvailable:base?.testAvailable,stateManaged:base?.stateManaged,connectionStatus:base?.connectionStatus,detail:base?.detail};
  if(ext)evidence={...evidence,status:ext.approval_pending?'PENDING_APPROVAL':!ext.configured&&['NOT_CONNECTED','DISCONNECTED'].includes(ext.status)?'SETUP_REQUIRED':ext.status,verified:ext.status==='CONNECTED',account:ext.account_name,lastSuccess:ext.last_sync_at,lastWebhook:ext.last_webhook_at,scopes:ext.scopes,slug:ext.slug,configured:ext.configured};
  if(def.id==='STRIPE'&&['LIVE_READY','TEST_READY'].includes(base?.status)&&verified.rows.length)evidence={...evidence,status:'CONNECTED',verified:true,lastSuccess:verified.rows[0].last_success};
  if(def.id==='MICROSOFT'){
   const mailVerified=base?.status==='READY'&&!!base.lastSuccess;
   evidence={...evidence,status:mailVerified||mailbox.status==='CONNECTED'?'CONNECTED':base?.status,verified:mailVerified||mailbox.status==='CONNECTED',account:mailbox.account||null,scopes:mailbox.scopes,mailboxStatus:mailbox.status,lastDiscovery:mailbox.last_sync_at};
   if(base?.status==='ERROR')evidence.status='ERROR';
   if(base?.lastFailure&&(!base.lastSuccess||new Date(base.lastFailure)>new Date(base.lastSuccess)))evidence.status='DEGRADED';
  }
  if(def.id==='TWILIO'&&base?.mode==='DEVELOPMENT')evidence.status='DISABLED';
  if(def.id==='WEBSITE')evidence={...evidence,status:'READY',mode:'Native public API',verified:false};
  return {...def,evidence,state:marketplaceState(def,evidence)};
 });
 const activity=[...webhooks.rows.map(r=>({...r,kind:'Webhook'})),...jobs.rows.map(r=>({...r,kind:r.mode==='EXTERNAL'||r.mode==='PROVIDER'?'Provider job':'Local job'})),...audit.rows.map(r=>({...r,provider:'SYSTEM',kind:'Connection audit',status:'RECORDED'}))].sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at)).slice(0,40);
 return {apps,metrics:marketplaceMetrics(apps),leadSources:leads.rows,activity,days,observedAt:new Date().toISOString()};
}
