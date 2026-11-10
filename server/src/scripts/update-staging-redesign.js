import {pool,query,transaction} from '../db/pool.js';
import {updateStagingBusinessPlans} from '../services/staging-business-plan-update.js';
import {updateStagingWebsiteRedesign} from '../services/staging-website-redesign-update.js';
try{
 if(process.env.APP_ENV!=='staging')throw Error('Staging only');
 const owner=(await query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.active=true AND r.name='OWNER' ORDER BY u.created_at LIMIT 1")).rows[0];if(!owner)throw Error('Staging Owner missing');
 const apply=process.argv.includes('--apply'),expectedVersion=process.argv.find(a=>a.startsWith('--expected-version='))?.split('=')[1];
 const req={user:owner,headers:{'user-agent':'Owner-approved staging website and internal business plan overhaul'}};
 const result=await transaction(async()=>{const business=await updateStagingBusinessPlans({apply,expectedVersion,req});const website=await updateStagingWebsiteRedesign({apply,expectedVersion:business.version||expectedVersion,req});return {business,website};});console.log(JSON.stringify(result));
}finally{await pool.end();}
