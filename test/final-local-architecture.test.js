import test from 'node:test';import assert from 'node:assert/strict';
import {attributionFrom} from '../server/src/services/integration-jobs-service.js';
import {publicInvoiceSummary} from '../server/src/services/invoice-access-service.js';
import {redactAudit,auditChanges} from '../shared/audit-summary.js';
import {providerStatus} from '../server/src/services/payment-service.js';
import {env} from '../server/src/config/env.js';
import {statusTone} from '../src/utils/display.js';
test('attribution retains allowed click identifiers and removes arbitrary PII and URL query data',()=>{assert.deepEqual(attributionFrom({gclid:'click',email:'private@example.invalid',landing_page_url:'https://example.invalid/pay?token=secret',referrer_url:'javascript:alert(1)'}),{gclid:'click',landing_page:'https://example.invalid/pay'});});
test('public invoice projection excludes bearer tokens, addresses and internal payment metadata',()=>{const value=publicInvoiceSummary({invoice_number:'INV',secure_token:'secret',client_email:'private',items:[{description:'Booth',quantity:1,unit_price:100,line_total:100,id:'internal'}],payments:[{id:'p',status:'SUCCEEDED',provider_payment_id:'internal'},{status:'FAILED'}]});assert.equal(value.secure_token,undefined);assert.equal(value.client_email,undefined);assert.equal(value.items[0].id,undefined);assert.equal(value.payments.length,1);assert.equal(value.payments[0].provider_payment_id,undefined);});
test('audit recursive detail redacts secrets and excludes secret fields from change summaries',()=>{assert.deepEqual(redactAudit({nested:{api_key:'secret',name:'safe'}}),{nested:{api_key:'[redacted]',name:'safe'}});assert.deepEqual(auditChanges({password_hash:'old',name:'A'},{password_hash:'new',name:'B'}),[{field:'name',before:'A',after:'B'}]);});
test('live Stripe configuration is not enabled by the local payment implementation',()=>{const original=env.stripeSecretKey;try{env.stripeSecretKey='sk_live_not_a_real_key';assert.equal(providerStatus().stripe.enabled,false);assert.equal(providerStatus().stripe.readiness,'DISABLED');}finally{env.stripeSecretKey=original;}});
test('test-mode and pending verification statuses are caution labels, not production-ready green',()=>{assert.equal(statusTone('TEST_READY'),'warning');assert.equal(statusTone('PENDING_VERIFICATION'),'warning');});
import fs from 'node:fs';
test('semantic status text meets 4.5:1 contrast against its actual stylesheet background',()=>{
 const css=fs.readFileSync(new URL('../src/styles/global.css',import.meta.url),'utf8');
 const luminance=hex=>{const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;};
 const colors=[...css.matchAll(/\.semantic-(success|warning|danger|neutral|info)\{color:#([a-f0-9]{6});background:#([a-f0-9]{6})/g)];assert.equal(colors.length,5);for(const [,name,fg,bg] of colors){const a=luminance(fg),b=luminance(bg);assert.ok((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)>=4.5,name);}
});
