import test from 'node:test';
import assert from 'node:assert/strict';
import { proposalEditInput } from '../server/src/services/proposal-edit-input.js';
test('proposal edit input retains custom services, sections and quoted amounts', () => {
  const input=proposalEditInput({line_items_snapshot:[{type:'PACKAGE',line_total:100},{type:'CUSTOM',description:'Activation',quantity:2,unit_price:25,line_total:50},{type:'ADDON',addon_id:'addon',line_total:30},{type:'TRAVEL',line_total:20}],pricing_snapshot:{tax_rate:7,deposit_value:30},content:{introduction:'Approved intro',terms:'Approved terms'},editable_sections:[{title:'Campaign'}],valid_through:'2027-01-02T00:00:00Z'});
  assert.equal(input.package_amount,100);assert.equal(input.custom_line_items[0].line_total,50);assert.equal(input.addons[0].addon_id,'addon');assert.equal(input.travel,20);assert.equal(input.terms,'Approved terms');assert.equal(input.tax_rate,7);assert.equal(input.sections[0].title,'Campaign');assert.equal(input.valid_through,'2027-01-02');
});
