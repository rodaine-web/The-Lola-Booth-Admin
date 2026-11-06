import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {pricingAddonDefaults} from '../server/src/services/pricing-catalog-defaults.js';
test('all configured and legacy add-ons resolve to bundled illustrations',async()=>{
 const context={window:{}};vm.runInNewContext(await fs.readFile('public/staging-site/addon-images.js','utf8'),context);
 for(const item of [...pricingAddonDefaults(),...['Guestbook','Additional Prints','Premium Backdrop','Custom Signage','Rush Delivery','Unconfigured enhancement'].map(name=>({name}))]){
  const src=context.window.lolaAddonImage(item);assert.match(src,/^assets\/[\w-]+\.jpg$/);assert.ok((await fs.stat('public/staging-site/'+src)).size>0,item.name);
 }
});
