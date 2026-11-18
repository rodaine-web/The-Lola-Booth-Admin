import {pool} from '../db/pool.js';
import {assertDatabaseIdentity} from '../config/database-identity.js';
import {processMailingQueue} from '../services/gallery-mailing-service.js';
await assertDatabaseIdentity(pool);
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
try{do{console.log(JSON.stringify({processed:await processMailingQueue({limit:25})}));if(!process.argv.includes('--watch'))break;await new Promise(resolve=>setTimeout(resolve,15000));}while(!stopping);}finally{await pool.end();}
