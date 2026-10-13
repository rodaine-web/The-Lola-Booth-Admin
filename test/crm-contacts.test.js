import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {contactSchema,leadImportSchema,safeSpreadsheetCell} from '../shared/crm-contacts.js';
import {automaticMapping,mappedImportRows} from '../server/src/services/crm-import-service.js';
import {readCrmSpreadsheet} from '../server/src/services/campaign-contact-import.js';
import {outlookScopes,recipientAllowed,discoverySchema,validateGraphCursor,checkpointHash} from '../server/src/services/crm-outlook-service.js';
test('positive consent requires evidence; identity and package lifecycle cannot be injected',()=>{
 const c={display_name:'QA',email:'qa@example.com'};
 assert.equal(contactSchema.parse(c).marketing_consent,'UNKNOWN');
 assert.equal(contactSchema.safeParse({...c,marketing_consent:'OPTED_IN'}).success,false);
 assert.equal(contactSchema.safeParse({...c,marketing_consent:'OPTED_IN',consent_source:'Signup checkbox',consented_at:'2026-10-12T12:00:00Z'}).success,true);
 assert.equal(contactSchema.safeParse({...c,secondary_email:c.email}).success,false);
 assert.equal(contactSchema.safeParse({...c,website:'javascript:alert(1)'}).success,false);
 assert.equal(leadImportSchema.safeParse({first_name:'Q',last_name:'A',email:c.email,phone:'3125550187',event_date:'2031-06-20',event_type:'Wedding',status:'WON'}).success,false);
 for(const value of ['=SUM(A1:A3)',' +1','@evil','-2'])assert.ok(safeSpreadsheetCell(value).startsWith("'"));
});
test('CSV mapping validates missing identity and duplicates without overwriting consent',()=>{
 const table=readCrmSpreadsheet({filename:'qa.csv',data:Buffer.from('Name,Email,Marketing Consent\nQA,qa@example.com,Unknown\nAnother,QA@example.com,Unknown\nNo Email,,Unknown\nConsent,consent@example.com,Yes').toString('base64')},'CONTACTS');
 const rows=mappedImportRows(table,{'0':'display_name','1':'email','2':'marketing_consent'},'CONTACTS');
 assert.deepEqual(rows.map(r=>r.status),['VALID','DUPLICATE','INVALID','INVALID']);
 assert.equal(rows[0].input.source,'SPREADSHEET');
 assert.throws(()=>mappedImportRows(table,{'0':'email','1':'email'},'CONTACTS'),/each supported field once/);
});
for(const kind of ['CONTACTS','LEADS'])test('real '+kind+' Excel template is parseable and example rows cannot create records',async()=>{
 const bytes=await fs.readFile(new URL('../server/templates/crm-'+kind.toLowerCase()+'-import.xlsx',import.meta.url));
 const table=readCrmSpreadsheet({filename:'template.xlsx',data:bytes.toString('base64')},kind),mapping=automaticMapping(table.headers,kind);
 assert.ok(table.headers.includes('Email'));assert.equal(mappedImportRows(table,mapping,kind)[0].status,'SKIP_EXAMPLE');
 const zip=unzipSync(bytes);const sheet=Object.keys(zip).find(p=>p.startsWith('xl/worksheets/sheet')&&strFromU8(zip[p]).includes('EXAMPLE'));
 assert.ok(sheet);zip[sheet]=strToU8(strFromU8(zip[sheet]).replace('EXAMPLE — REMOVE',''));
 const edited=readCrmSpreadsheet({filename:'template.xlsx',data:Buffer.from(zipSync(zip)).toString('base64')},kind);
 const rows=mappedImportRows(edited,automaticMapping(edited.headers,kind),kind);
 assert.equal(rows[0].status,'VALID',rows[0].message);if(kind==='LEADS')assert.equal(rows[0].input.event_date,'2031-06-20');
});
test('shared mailbox discovery uses least privilege and safe fixed mailbox paging',()=>{
 assert.deepEqual(outlookScopes('SENT'),['openid','offline_access','User.Read','Mail.ReadBasic.Shared']);
 const p=discoverySchema.parse({});assert.equal(p.includeCc,false);assert.equal(p.includeBcc,false);
 for(const email of ['info@thelolabooth.com','lola@thelolabooth.com','staff@thelolabooth.com','noreply@example.com','bad'])assert.equal(recipientAllowed(email,p),false);
 assert.equal(recipientAllowed('customer@example.com',p),true);
 for(const mailbox of ['info%40thelolabooth.com','info@thelolabooth.com'])assert.ok(validateGraphCursor('https://graph.microsoft.com/v1.0/users/'+mailbox+'/mailFolders/sentitems/messages/delta?$skiptoken=opaque'));
 assert.ok(validateGraphCursor("https://graph.microsoft.com/v1.0/users/info@thelolabooth.com/mailFolders('sentitems')/messages/delta?$deltatoken=opaque"));
 assert.throws(()=>validateGraphCursor("https://graph.microsoft.com/v1.0/users/info@thelolabooth.com/mailFolders('inbox')/messages/delta"));
 for(const url of ['https://evil.example/v1.0/users/info@thelolabooth.com/contacts/delta','https://graph.microsoft.com/v1.0/users/other@example.com/contacts/delta','https://graph.microsoft.com/v1.0/users/info@thelolabooth.com/messages','https://graph.microsoft.com/v1.0/users/info@thelolabooth.com/../other@example.com/contacts/delta'])assert.throws(()=>validateGraphCursor(url));
 assert.notEqual(checkpointHash('SENT',p),checkpointHash('SENT',{...p,to:'2026-10-12'}));
 assert.notEqual(checkpointHash('SENT',p),checkpointHash('SENT',{...p,includeBcc:true}));
});
