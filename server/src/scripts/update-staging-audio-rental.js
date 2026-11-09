import {pool,query} from '../db/pool.js';
import {updateStagingAudioRental} from '../services/staging-audio-rental-update.js';
try{
 if(process.env.APP_ENV!=='staging')throw Error('Staging only');
 const owner=(await query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.active=true AND r.name='OWNER' ORDER BY u.created_at LIMIT 1")).rows[0];if(!owner)throw Error('Staging Owner not found');
 const arg=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.split('=')[1];
 console.log(JSON.stringify(await updateStagingAudioRental({apply:process.argv.includes('--apply'),expectedVersion:arg('expected-version'),inventoryIds:(arg('inventory-ids')||'').split(',').filter(Boolean),req:{user:owner,headers:{'user-agent':'Owner-authorized staging Audio rental update'}}})));
}finally{await pool.end();}
