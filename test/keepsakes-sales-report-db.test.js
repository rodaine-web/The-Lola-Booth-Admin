import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
test('report enforces finance access, paid date window, duplicate payment exclusion and current reservations',{skip:!process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.BOOKING_LIFECYCLE_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.match(url.pathname,/_qa$/);
 const bootstrap=new pg.Pool({connectionString:url.toString()}),schema='salesreport_'+crypto.randomBytes(5).toString('hex');let pool;
 try{
 await bootstrap.query(`CREATE SCHEMA ${schema}`);url.searchParams.set('options',`-c search_path=${schema},public`);
 Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',NODE_ENV:'test',JWT_SECRET:'synthetic-report-test-only',CLIENT_ORIGIN:'http://localhost:5173',EMAIL_PROVIDER:'development'});
 const db=await import('../server/src/db/pool.js');pool=db.pool;
 await db.query(`CREATE TABLE keepsakes_orders(id int,status text,paid_at timestamptz,total_cents int,refunded_cents int,subtotal_cents int,shipping_cents int,tax_cents int,last_error text,snapshot jsonb,stripe_payment_intent text,mode text);
 CREATE TABLE reporting_payments(provider text,provider_payment_id text,deleted_at timestamptz,status text,paid_at timestamptz,payment_date date,created_at timestamptz);
 CREATE TABLE keepsakes_products(id text,catalogue_key text,title text,active boolean,operational_config jsonb,provider text,retired_at timestamptz);
 CREATE TABLE keepsakes_fulfillments(order_id int,item_index int,status text);`);
 const item={units:2,inventoryReserved:true,product:{id:'magnet',key:'magnet',title:'Photo Magnet'}};
 for(const [id,paid,intent] of [[1,'2035-01-02','pi_one'],[2,'2035-01-03','pi_two'],[3,'2034-12-01','pi_old'],[4,null,'pi_unpaid']])await db.query(`INSERT INTO keepsakes_orders VALUES($1,'PAID',$2,1490,0,1000,500,90,NULL,$3,$4,'TEST')`,[id,paid,JSON.stringify({discount:{cents:100},items:[item]}),intent]);
 await db.query(`INSERT INTO reporting_payments VALUES('STRIPE','pi_one',NULL,'SUCCEEDED','2035-01-02',NULL,NULL);
 INSERT INTO keepsakes_products VALUES('magnet','magnet','Photo Magnet',true,'{"stockUnits":7,"stockConfirmed":true}','IN_HOUSE',NULL),('keychain','keychain','Photo Keychain',true,'{"stockUnits":null,"stockConfirmed":true}','IN_HOUSE',NULL);
 INSERT INTO keepsakes_fulfillments VALUES(2,0,'FULFILLED');`);
 const {keepsakesSalesReport}=await import('../server/src/services/keepsakes-sales-report-service.js');
 const options={user:{roles:['ADMIN'],permissions:['read:finance']},range:{start:'2035-01-01',end:'2035-02-01'},bookingCollected:20};
 const result=await keepsakesSalesReport(options);assert.equal(result.totals.paidOrders,2);assert.equal(result.totals.merchandiseCents,1800);assert.equal(result.combinedCollectedPreviewCents,3490);
 const stock=result.inventory.find(r=>r.key==='magnet');assert.equal(stock.available_units,7);assert.equal(stock.committed_units,4);assert.equal(result.inventory.find(r=>r.key==='keychain').available_units,null);
 assert.deepEqual(await keepsakesSalesReport({...options,user:{roles:['ADMIN'],permissions:[]}}),{available:false});
 assert.deepEqual(await keepsakesSalesReport({...options,user:{roles:['STAFF'],permissions:['*']}}),{available:false});
 }finally{if(pool)await pool.end();await bootstrap.query(`DROP SCHEMA ${schema} CASCADE`);await bootstrap.end();}
});
