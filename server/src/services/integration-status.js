import {getEmailProviderReadiness} from './email-service.js';
import {env} from '../config/env.js';
export function emailIntegrationStatus(config=env){
 try{const readiness=getEmailProviderReadiness(config);return {provider:readiness.provider.toUpperCase(),category:'EMAIL',status:readiness.active?'READY':'DISABLED',connected_account:readiness.senderEmail||readiness.from,metadata:{mode:readiness.active?'Provider configured':'Development — no external delivery'},readiness};}
 catch{return {provider:String(config.emailProvider||'EMAIL').toUpperCase(),category:'EMAIL',status:'ERROR',metadata:{mode:'Required provider configuration is incomplete'}};}
}
