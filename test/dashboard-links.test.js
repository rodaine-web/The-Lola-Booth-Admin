import test from 'node:test';
import assert from 'node:assert/strict';
import { funnelHref, sourceHref } from '../src/utils/dashboard-links.js';
test('dashboard links preserve date windows and matching stage/source filters', () => {
  const range={start:'2026-09-01',end:'2026-10-01'};
  for(const [key,path,filter] of [['proposals_sent','/sales/proposals','sent'],['proposals_accepted','/sales/proposals','accepted'],['booked','/sales/leads','booked'],['qualified','/sales/leads','qualified']]) {
    const url=new URL(funnelHref(key,range),'https://admin.test');
    assert.equal(url.pathname,path); assert.equal(url.searchParams.get('funnel'),filter);assert.equal(url.searchParams.get('from'),range.start);assert.equal(url.searchParams.get('to'),range.end);
  }
  const source=new URL(sourceHref('Social & referrals',range),'https://admin.test');assert.equal(source.searchParams.get('source_group'),'Social & referrals');assert.equal(source.searchParams.get('from'),range.start);
});
