import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import * as mailing from '../../server/src/services/gallery-mailing-service.js';
import {encryptSecretJson} from '../../server/src/services/integration-secrets.js';
import {galleryStorage} from '../../server/src/services/gallery-storage.js';
import {importFiestaShares} from '../../server/src/services/fiesta-gallery-service.js';
import {prepareBulkPostcards,uploadBackArtwork,approveBackArtwork} from '../../server/src/services/gallery-postcard-artwork-service.js';
import {batchApprove} from '../../server/src/services/gallery-postcard-workflow-service.js';
import {renderProof} from '../../server/src/services/lob-print-ready-service.js';
import {verifyLobSignature,mailingRecipientKey} from '../../shared/gallery-mailing-policy.js';
export async function qualifyMailingRelease({db,user}){
 const old={APP_ENV:process.env.APP_ENV,GALLERY_STORAGE_PROVIDER:process.env.GALLERY_STORAGE_PROVIDER,GALLERY_LOCAL_ROOT:process.env.GALLERY_LOCAL_ROOT,GALLERY_ENABLED:process.env.GALLERY_ENABLED,GALLERY_MAILING_WORKER_ENABLED:process.env.GALLERY_MAILING_WORKER_ENABLED,LOB_TEST_API_KEY:process.env.LOB_TEST_API_KEY,LOB_FROM_ADDRESS_ID:process.env.LOB_FROM_ADDRESS_ID,LOB_TEST_WEBHOOK_SECRET:process.env.LOB_TEST_WEBHOOK_SECRET};
 const root=await fs.mkdtemp('/private/tmp/lola-mailing-release-');
 Object.assign(process.env,{APP_ENV:'development',GALLERY_STORAGE_PROVIDER:'local',GALLERY_LOCAL_ROOT:root,GALLERY_ENABLED:'true',GALLERY_MAILING_WORKER_ENABLED:'true',LOB_TEST_API_KEY:'test_synthetic_only',LOB_FROM_ADDRESS_ID:'adr_synthetic',LOB_TEST_WEBHOOK_SECRET:'synthetic-webhook-signing-secret-123456'});
 const admin={...user,permissions:['*'],roles:['OWNER']},one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const originalFetch=globalThis.fetch;let attempts=0;const created=new Map();
 try{
 const client=await one("INSERT INTO clients(name,email,client_type) VALUES('Mailing QA Client','mailing-client@example.invalid','CORPORATE') RETURNING *");
 const event=await one("INSERT INTO events(client_id,event_name,event_type,event_date,status) VALUES($1,'MAILING RELEASE QA','Corporate Event','2035-11-13','CONFIRMED') RETURNING *",[client.id]);
 const proposal=await one("INSERT INTO proposals(proposal_number,client_id,event_id,status,total) VALUES('MAILING-QA',$1,$2,'CONVERTED',1200) RETURNING *",[client.id,event.id]);
 const version=await one('INSERT INTO proposal_versions(proposal_id,version_number,snapshot) VALUES($1,1,$2) RETURNING id',[proposal.id,{content:{postcard_mailing:{quantity:2}}}]);await db.query('UPDATE proposals SET accepted_version_id=$2 WHERE id=$1',[proposal.id,version.id]);
 const contract=await one("INSERT INTO contracts(proposal_id,revision,status,title,terms,snapshot,signed_at,signer_name,signer_email,document_hash) VALUES($1,1,'SIGNED','Synthetic QA agreement','No real obligation',$2,now(),'Mailing QA Client',$3,'fixture') RETURNING id",[proposal.id,{accepted_version_id:version.id},client.email]);
 const grant=await one('INSERT INTO client_workspace_grants(proposal_id,client_id,signed_contract_id) VALUES($1,$2,$3) RETURNING id',[proposal.id,client.id,contract.id]);
 const album=await one("INSERT INTO gallery_albums(event_id,title,status,expires_at,published_at) VALUES($1,'MAILING RELEASE QA','PUBLISHED',now()+interval '30 days',now()) RETURNING *",[event.id]);
 const session={client_id:client.id,email:client.email};
 const returnAddress={name:'Mailing QA Client',address_line1:'1935 S Wabash Ave',address_line2:'#301',address_city:'Chicago',address_state:'IL',address_zip:'60616',address_country:'US'};
 const address={name:'Synthetic Guest',address_line1:'100 QA Example Ave',address_line2:'',address_city:'Chicago',address_state:'IL',address_zip:'60601',address_country:'US'};
 assert.equal(mailingRecipientKey(address,'salt'),mailingRecipientKey({...address,address_line1:'100 qa example ave.'},'salt'));
 const csv=(zip='60601')=>{
 const pairs=[['Full name','Synthetic Guest'],['Address line 1','100 QA Example Ave'],['City','Chicago'],['State','IL'],['ZIP code',zip],['Country','US'],['Mailing preference','Yes'],['Consent to postcard mailing','Yes']];
 const headers=['Shared via','Email Address','Phone Number','Content Link','File Name','Share Time',...pairs.flatMap((_,i)=>[i?`Question ${i+1}`:'Question',i?`Answer ${i+1}`:'Answer'])];
 const quote=x=>'"'+String(x).replaceAll('"','""')+'"';
 return [headers,...['one@example.invalid','two@example.invalid'].map(email=>['E-mail',email,'','https://boothpics.com/RELEASEQA/CAPTURE','RELEASEQA.png','2026-11-13 10:00 CST',...pairs.flat()])].map(row=>row.map(quote).join(',')).join('\n');
 };
 await importFiestaShares(album.id,csv(),'RELEASEQA',admin);
 const store=galleryStorage(),photo=await sharp({create:{width:1800,height:1200,channels:3,background:'#223344'}}).png().toBuffer();
 const key=await store.put(photo,'image/png');
 const media=await one("INSERT INTO gallery_media(album_id,storage_provider,storage_key,filename,mime_type,size_bytes,checksum) VALUES($1,'local',$2,'RELEASEQA.png','image/png',$3,$4) RETURNING id",[album.id,key,photo.length,crypto.createHash('sha256').update(photo).digest('hex')]);
 await importFiestaShares(album.id,csv(),'RELEASEQA',admin);
 const back=await sharp({create:{width:1875,height:1275,channels:3,background:'#baa17a'}}).png().toBuffer();
 const art=await uploadBackArtwork(album.id,{filename:'QA-back.png',mime_type:'image/png',base64:back.toString('base64')},admin);await approveBackArtwork(album.id,art.id,admin);
 const recipients=(await db.query('SELECT * FROM gallery_postcard_recipients WHERE album_id=$1 ORDER BY id',[album.id])).rows;
 assert.equal((await prepareBulkPostcards(album.id,art.id,recipients.map(r=>r.id),admin)).prepared,2);
 const cards=(await db.query('SELECT * FROM gallery_postcards WHERE album_id=$1 ORDER BY id',[album.id])).rows;
 await batchApprove(album.id,cards.map(c=>c.id),admin);
 await assert.rejects(mailing.configureMailing(album.id,{quantity_limit:3,cost_limit_cents:300,unit_cost_cents:100,override_reason:''},admin));
 await mailing.configureMailing(album.id,{quantity_limit:2,cost_limit_cents:200,unit_cost_cents:100,override_reason:''},admin);
 const view=await mailing.clientMailingView(session,event.id);assert.equal(view.request,null);assert.equal(JSON.stringify(view).includes('60601'),false);
 await assert.rejects(mailing.requestClientMailing({...session,client_id:crypto.randomUUID()},event.id,{quantity:2,notes:'No access',return_address:returnAddress}));
 await mailing.requestClientMailing(session,event.id,{quantity:2,notes:'Please mail approved guest photos.',return_address:returnAddress});
 const request=(await mailing.mailingSummary(album.id,admin)).requests[0];await mailing.reviewClientMailing(album.id,request.id,{status:'APPROVED',note:'Approved for QA'},admin);
 await assert.rejects(mailing.enqueueMailing(album.id,cards[0].id,admin));
 for(const card of cards)await mailing.approvePersonalizedProof(album.id,card.id,admin);
 const proof=await renderProof(album.id,cards[0].id);const {data,info}=await sharp(proof.back).raw().toBuffer({resolveWithObject:true});
 assert.deepEqual([...data.subarray((600*info.width+1200)*info.channels,(600*info.width+1200)*info.channels+3)],[255,255,255],'actual back reserves the mailing area');
 assert.notEqual(crypto.createHash('sha256').update(proof.back).digest('hex'),crypto.createHash('sha256').update(proof.personalizedBack).digest('hex'),'personalized review includes address guides');
 const queued=await mailing.enqueueMailing(album.id,cards[0].id,admin);assert.equal(queued.status,'PENDING');
 assert.equal((await mailing.enqueueMailing(album.id,cards[0].id,admin)).jobId,queued.jobId,'double-click reuses existing job');
 const storedSender=(await one('SELECT sender_ciphertext FROM gallery_mailing_jobs WHERE id=$1',[queued.jobId])).sender_ciphertext;
 const changedReturn={...returnAddress,address_line1:'200 Alternate QA Street'};
 await mailing.requestClientMailing(session,event.id,{quantity:2,notes:'Changed return address',return_address:changedReturn});
 assert.deepEqual((await one('SELECT sender_ciphertext FROM gallery_mailing_jobs WHERE id=$1',[queued.jobId])).sender_ciphertext,storedSender,'queued return address is immutable');
 await db.query("UPDATE gallery_mailing_jobs SET status='PROCESSING' WHERE id=$1",[queued.jobId]);
 const {claimPostcardDispatch}=await import('../../server/src/services/postcard-dispatch-claim.js');
 assert.equal((await claimPostcardDispatch(album.id,cards[0].id,cards[0].person_id,{jobId:queued.jobId})).rowCount,0,'changed unapproved return address blocks dispatch');
 await mailing.reviewClientMailing(album.id,request.id,{status:'APPROVED',note:'New address reviewed'},admin);
 assert.equal((await claimPostcardDispatch(album.id,cards[0].id,cards[0].person_id,{jobId:queued.jobId})).rowCount,0,'a newly approved address cannot rewrite an old queued sender');
 await db.query("UPDATE gallery_mailing_jobs SET status='PENDING' WHERE id=$1",[queued.jobId]);
 await mailing.requestClientMailing(session,event.id,{quantity:2,notes:'Original return address confirmed',return_address:returnAddress});await mailing.reviewClientMailing(album.id,request.id,{status:'APPROVED',note:'Original return address reviewed'},admin);

 await assert.rejects(mailing.enqueueMailing(album.id,cards[1].id,admin),'alternate email cannot bypass recipient deduplication');
 await mailing.enqueueMailing(album.id,cards[1].id,admin,'Admin approved extra copy for synthetic QA');
 await assert.rejects(mailing.configureMailing(album.id,{quantity_limit:1,cost_limit_cents:100,unit_cost_cents:100,override_reason:''},admin),'cannot shrink below reserved spend');
 globalThis.fetch=async(url,options={})=>{
  assert.ok(String(url).startsWith('https://api.lob.com/v1/postcards'),'provider origin is fixed');
  if(options.method==='POST'){
   attempts++;const form=options.body;const postcardId=form.get('metadata[postcard_id]'),jobId=form.get('metadata[mailing_job_id]');
   assert.equal(form.get('from[name]'),'Mailing QA Client');assert.equal(form.get('from[address_line2]'),'#301');assert.equal(form.get('from'),null,'global sender IDs must not replace the client return address');
   assert.ok(options.headers['Idempotency-Key'].startsWith(postcardId+':'));
   assert.equal((await sharp(Buffer.from(await form.get('front').arrayBuffer())).metadata()).width,1875);
   if(attempts===2||attempts===3)throw Error('Synthetic unknown provider outcome');
   const item={id:'psc_QA'+attempts,status:'processed',metadata:{postcard_id:postcardId,mailing_job_id:jobId}};created.set(item.id,item);return new Response(JSON.stringify(item),{status:200});
  }
  const item=created.get(String(url).split('/').at(-1));return new Response(JSON.stringify(item||{}),{status:item?200:404});
 };
 const results=await mailing.processMailingQueue({limit:5});assert.deepEqual(results.map(r=>r.status),['SUBMITTED','NEEDS_REVIEW']);assert.equal(attempts,2);
 await mailing.processMailingQueue();assert.equal(attempts,2,'unknown outcomes are never automatically retried');
 const failed=await one("SELECT p.* FROM gallery_postcards p JOIN gallery_mailing_jobs j ON j.postcard_id=p.id WHERE j.album_id=$1 AND j.status='NEEDS_REVIEW'",[album.id]);
 await assert.rejects(mailing.reconcilePostcard(album.id,failed.id,{reason:'Need provider confirmation',confirm_not_created:false},admin));
 await importFiestaShares(album.id,csv('60602'),'RELEASEQA',admin);
 const rebuilt=await mailing.reconcilePostcard(album.id,failed.id,{reason:'Synthetic provider audit confirms no postcard was created',confirm_not_created:true},admin);assert.equal(rebuilt.rebuilt,true);
 assert.equal((await one('SELECT revision FROM gallery_postcards WHERE id=$1',[failed.id])).revision,2);
 await batchApprove(album.id,[failed.id],admin);await mailing.approvePersonalizedProof(album.id,failed.id,admin);
 await mailing.enqueueMailing(album.id,failed.id,admin,'Admin authorized corrected synthetic revision');
 assert.equal((await mailing.processMailingQueue({limit:1}))[0].status,'NEEDS_REVIEW');assert.equal(attempts,3);
 // A matching provider record may confirm an uncertain response, without issuing another postcard.
 const failedJob=await one('SELECT id FROM gallery_mailing_jobs WHERE postcard_id=$1 ORDER BY revision DESC LIMIT 1',[failed.id]);
 created.set('psc_QArecovered',{id:'psc_QArecovered',status:'rendered',metadata:{postcard_id:failed.id,mailing_job_id:failedJob.id}});
 await mailing.linkProviderPostcard(album.id,failed.id,'psc_QArecovered',admin);assert.equal((await one('SELECT status FROM gallery_postcards WHERE id=$1',[failed.id])).status,'SUBMITTED_TEST');assert.equal(attempts,3);
 const webhook=(id,type,date)=>{const raw=Buffer.from(JSON.stringify({id,event_type:{id:type},reference_id:'psc_QA1',date_created:date,body:{id:'psc_QA1'}})),stamp=String(Math.floor(Date.now()/1000));return {raw,headers:{'lob-signature-timestamp':stamp,'lob-signature':crypto.createHmac('sha256',process.env.LOB_TEST_WEBHOOK_SECRET).update(stamp+'.').update(raw).digest('hex')}};};
 const eventData=webhook('evt_QAnew','postcard.delivered',new Date().toISOString());assert.equal(verifyLobSignature(eventData.raw,eventData.headers,process.env.LOB_TEST_WEBHOOK_SECRET),true);
 await assert.rejects(mailing.receiveLobEvent(eventData.raw,{...eventData.headers,'lob-signature':'0'.repeat(64)}));
 await mailing.receiveLobEvent(eventData.raw,eventData.headers);await mailing.receiveLobEvent(eventData.raw,eventData.headers);
 const oldEvent=webhook('evt_QAold','postcard.mailed',new Date(Date.now()-60000).toISOString());await mailing.receiveLobEvent(oldEvent.raw,oldEvent.headers);
 assert.equal((await one("SELECT lob_status FROM gallery_postcards WHERE lob_postcard_id='psc_QA1'")).lob_status,'delivered','older callbacks cannot regress status');
 assert.equal((await one("SELECT count(*)::int n FROM gallery_lob_events WHERE event_id='evt_QAnew'")).n,1);
 assert.equal(verifyLobSignature(eventData.raw,{...eventData.headers,'lob-signature-timestamp':'1000000000'},process.env.LOB_TEST_WEBHOOK_SECRET),false);
 const newVersion=await one('INSERT INTO proposal_versions(proposal_id,version_number,snapshot) VALUES($1,2,$2) RETURNING id',[proposal.id,{content:{postcard_mailing:{quantity:1}}}]);await db.query('UPDATE proposals SET accepted_version_id=$2 WHERE id=$1',[proposal.id,newVersion.id]);
 await assert.rejects(mailing.enqueueMailing(album.id,cards[0].id,admin),'a changed accepted version invalidates mailing authorization');await db.query('UPDATE proposals SET accepted_version_id=$2 WHERE id=$1',[proposal.id,version.id]);
 const {qualifyLiveMailing}=await import('./gallery-live-qualification.js');
 await qualifyLiveMailing({db,admin,album,card:failed,root});
 // Browser qualification uses the same real API and private fixture, with no outbound adapters.
 globalThis.fetch=originalFetch;
 if(process.env.LOLA_QA_FRONTEND_DIR){const {qualifyReleaseBrowser}=await import('./gallery-release-browser.js');await qualifyReleaseBrowser({db,user:admin,client,event,album,proposal,contract,grant,photo,art,root});}
 }finally{
 globalThis.fetch=originalFetch;for(const [key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fs.rm(root,{recursive:true,force:true});
 }
}
