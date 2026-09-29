import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {pool} from '../db/pool.js';
const permissions = [
  "*",
  "read:dashboard", "read:admin",
  "read:sales", "write:sales",
  "read:events", "write:events",
  "read:operations", "write:operations",
  "event.operations.view", "event.operations.manage",
  "event.checklist.manage",
  "event.incident.create", "event.incident.manage",
  "equipment.checkout", "equipment.return", "equipment.override",
  "staff.brief.send", "gallery.delivery.send",
  "read:finance", "write:finance",
  "read:content", "write:content",
  "read:tasks", "write:tasks",
  "read:analytics",
  "read:audit",
  "read:settings", "write:settings",
  "read:integrations", "write:integrations",
  "read:website", "write:website", "publish:website",
  "read:notifications", "write:notifications",
  "issue:refunds",
  "read:attendant"
];

const rolePermissions = {
  OWNER: ["*"],
  ADMIN: permissions.filter((key) => key !== "*"),
  SALES: ["read:dashboard", "read:sales", "write:sales", "read:events", "read:content", "read:tasks", "write:tasks"],
  EVENT_MANAGER: ["read:dashboard", "read:events", "write:events", "read:operations", "write:operations", "event.operations.view", "event.operations.manage", "event.checklist.manage", "event.incident.create", "event.incident.manage", "equipment.checkout", "equipment.return", "staff.brief.send", "gallery.delivery.send", "read:content", "read:tasks", "write:tasks", "read:notifications", "write:notifications"],
  ATTENDANT: ["read:attendant", "event.operations.view", "event.checklist.manage", "event.incident.create", "equipment.checkout", "equipment.return", "read:notifications"]
};


const client=await pool.connect();
try {
 await client.query('BEGIN');
 await client.query("SELECT pg_advisory_xact_lock(7292026)");
 const existing=await client.query('SELECT id FROM users LIMIT 1');
 if(!existing.rowCount){
  if(process.env.APP_ENV!=='production'||process.env.PRODUCTION_OWNER_EMAIL!=='info@thelolabooth.com'||!/^[a-f0-9]{64}$/.test(process.env.PRODUCTION_OWNER_TOKEN_HASH||'')) throw new Error('Production owner initialization is not configured.');
  for(const key of permissions)await client.query('INSERT INTO permissions(key) VALUES($1) ON CONFLICT DO NOTHING',[key]);
  for(const [role,keys] of Object.entries(rolePermissions)){
   const {rows:[row]}=await client.query('INSERT INTO roles(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id',[role]);
   for(const key of keys)await client.query('INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key=$2 ON CONFLICT DO NOTHING',[row.id,key]);
  }
  const passwordHash=await bcrypt.hash(crypto.randomBytes(48).toString('hex'),12);
  const {rows:[owner]}=await client.query("INSERT INTO users(name,email,password_hash,invitation_status) VALUES('LOLA Owner',$1,$2,'INVITED') RETURNING id",[process.env.PRODUCTION_OWNER_EMAIL,passwordHash]);
  await client.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='OWNER'",[owner.id]);
  await client.query("INSERT INTO user_account_tokens(user_id,token_hash,token_type,expires_at) VALUES($1,$2,'INVITATION',now()+interval '24 hours')",[owner.id,process.env.PRODUCTION_OWNER_TOKEN_HASH]);
  await client.query("UPDATE automations SET enabled=false");
  console.log('Production owner initialized; no sample business records inserted.');
 }
 await client.query('COMMIT');
 const migrations=await client.query('SELECT count(*)::int AS count FROM schema_migrations');
 console.log(JSON.stringify({migrationCount:migrations.rows[0].count}));
 for(const table of ['clients','leads','events','proposals','invoices','payments']){
  const {rows}=await client.query('SELECT count(*)::int AS count FROM '+table);
  console.log(JSON.stringify({table,count:rows[0].count}));
 }
} catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();await pool.end();}
