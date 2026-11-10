// Explicit maintenance operation; never runs during deployment or migration.
import {pool,query} from '../db/pool.js';
import {updateStagingExperiences} from '../services/staging-experience-update.js';
try{
 if(process.env.APP_ENV!=='staging')throw new Error('This command is staging-only.');
 const apply=process.argv.includes('--apply'),expectedVersion=process.argv.find(x=>x.startsWith('--expected-version='))?.split('=')[1];
 const owner=(await query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.active=true AND r.name='OWNER' ORDER BY u.created_at LIMIT 1")).rows[0];
 if(!owner)throw new Error('Staging Owner not found.');
 const result=await updateStagingExperiences({apply,expectedVersion,req:{user:{...owner,permissions:['*']},headers:{'user-agent':'Owner-authorized staging catalogue update'}}});
 console.log(JSON.stringify(result));
}finally{await pool.end();}
