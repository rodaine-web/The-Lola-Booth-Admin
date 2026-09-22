import fs from 'node:fs/promises';
import pg from 'pg';
const connectionString=process.env.DATABASE_PUBLIC_URL;
if(!connectionString)throw new Error('Railway PostgreSQL public connection variable is required. No connection attempted.');
const db=new pg.Client({connectionString,options:'-c default_transaction_read_only=on -c statement_timeout=15000',connectionTimeoutMillis:15000});
try {
 await db.connect();await db.query('BEGIN READ ONLY');
 const migrations=(await db.query('SELECT filename FROM schema_migrations ORDER BY filename')).rows;
 const tables=['packages','experiences','website_content','website_hero_slides','website_gallery_items','website_event_types','faqs','testimonials','media_library','business_settings'];
 const records={};
 for(const table of tables)records[table]=(await db.query(`SELECT * FROM ${table}`)).rows;
 await db.query('ROLLBACK');
 await fs.mkdir('audit-output/website-cms/production',{recursive:true,mode:0o700});
 await fs.writeFile('audit-output/website-cms/production/preflight.json',JSON.stringify({checkedAt:new Date().toISOString(),migrations,records},null,2),{mode:0o600});
 console.log(JSON.stringify({readOnly:true,migrations:migrations.map(x=>x.filename),counts:Object.fromEntries(Object.entries(records).map(([k,v])=>[k,v.length]))},null,2));
}finally{await db.end();}
