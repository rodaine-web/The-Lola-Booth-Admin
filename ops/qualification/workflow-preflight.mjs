// Read-only deployment/queue inventory. Never emit credentials, recipients or customer data.
import {createRequire} from 'node:module';
const require=createRequire(process.cwd()+'/package.json');
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const one=async(sql)=>(await client.query(sql)).rows;
 const identity=(await one('SELECT system_identifier::text id FROM pg_control_system()'))[0].id;
 if(identity!==process.env.EXPECTED_DATABASE_SYSTEM_ID)throw Error('Unexpected database identity');
 const result={environment:process.env.APP_ENV,revision:process.env.RAILWAY_GIT_COMMIT_SHA||null,identityVerified:true,
  flags:Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(BOOKING_.*_ENABLED|TASK_NOTIFICATIONS_(ENABLED|SINCE)|STAGING_AUTOMATIONS_(ENABLED|SINCE)|PRODUCTION_AUTOMATIONS_(ENABLED|SINCE)|PRODUCTION_EMAIL_ENABLED|STAGING_EMAIL_ENABLED|GALLERY_DROPBOX_SYNC_ENABLED|GALLERY_PUBLIC_ORIGIN|STRIPE_(LIVE_PAYMENTS_ENABLED|AUTOMATIC_TAX_ENABLED|TAX_CODE|TAX_CODE_OVERRIDES))$/.test(k))),
  stripeMode:/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY||'')?'LIVE':/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY||'')?'TEST':'MISSING',
  migrations:await one('SELECT filename FROM schema_migrations ORDER BY filename'),
  jobs:await one('SELECT job_type,status,count(*)::int count,min(created_at) oldest FROM automation_jobs GROUP BY job_type,status ORDER BY job_type,status'),
  communications:await one("SELECT status,count(*)::int count,min(created_at) oldest FROM communications GROUP BY status ORDER BY status"),
  tasks:await one("SELECT status,count(*)::int count,count(*) FILTER(WHERE assigned_user_id IS NULL)::int unassigned FROM tasks WHERE deleted_at IS NULL GROUP BY status ORDER BY status"),
  checkouts:await one("SELECT a.provider,a.status,count(*)::int count,min(a.created_at) oldest FROM payment_attempts a GROUP BY a.provider,a.status"),
  currentUnsignedBookings:await one("SELECT count(*)::int count FROM invoices i WHERE i.proposal_id IS NOT NULL AND i.deleted_at IS NULL AND i.status NOT IN ('PAID','VOID','REFUNDED') AND NOT EXISTS(SELECT 1 FROM contracts c WHERE c.proposal_id=i.proposal_id AND c.status='SIGNED')")};
 const pending=(await client.query("SELECT provider_session_id FROM payment_attempts WHERE provider='STRIPE' AND status='PENDING' ORDER BY created_at LIMIT 100")).rows;
 await client.query('COMMIT');
 if(process.env.STRIPE_SECRET_KEY){
  const r=await fetch('https://api.stripe.com/v1/account',{headers:{Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,'Stripe-Version':'2026-08-26.dahlia'}}),a=await r.json();
  result.stripeAccount={verified:r.ok&&a.id===process.env.STRIPE_ACCOUNT_ID,chargesEnabled:!!a.charges_enabled};
  result.pendingProviderStatuses=[];
  for(const attempt of pending){
   const response=await fetch('https://api.stripe.com/v1/checkout/sessions/'+encodeURIComponent(attempt.provider_session_id),{headers:{Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,'Stripe-Version':'2026-08-26.dahlia'}}),session=await response.json();
   result.pendingProviderStatuses.push({verified:response.ok,status:session.status||'UNKNOWN',paymentStatus:session.payment_status||'UNKNOWN',livemode:session.livemode});
  }
 }
 console.log(JSON.stringify(result));
}finally{client.release();await pool.end();}
