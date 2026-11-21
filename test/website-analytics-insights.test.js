import test from 'node:test';import assert from 'node:assert/strict';
import {previousAnalyticsDates,websiteAnalyticsInsights} from '../shared/website-analytics-insights.js';
test('comparison dates use the preceding equal-length calendar period, including leap days',()=>{
 assert.deepEqual(previousAnalyticsDates({startDate:'2024-03-01',endDate:'2024-03-02',timeZone:'America/Chicago'}),{startDate:'2024-02-28',endDate:'2024-02-29',timeZone:'America/Chicago'});
 assert.equal(previousAnalyticsDates({startDate:'2026-11-20',endDate:'2026-11-20'}).startDate,'2026-11-19');
});
test('insights explain measurement gaps without treating GA events as people or revenue',()=>{
 const report={summary:{sessions:100,inquiryEvents:0},previous:{summary:{sessions:50}},crmSummary:{inquiries:4},inquiryEvent:'generate_lead',sources:[{sessionDefaultChannelGroup:'Organic Search',sessions:70}],crmOnlyCampaigns:[{inquiries:2}]};
 const text=JSON.stringify(websiteAnalyticsInsights(report));assert.match(text,/100.0% higher/);assert.match(text,/CRM recorded 4 inquiries/);assert.match(text,/not establish why/);assert.match(text,/UTM/);assert.doesNotMatch(text,/buy ads|guarantee|unique visitors/);
});
test('zero prior traffic does not produce invented percentage changes',()=>{
 assert.ok(!websiteAnalyticsInsights({summary:{sessions:0},previous:{summary:{sessions:0}}}).some(x=>x.body.includes('%')));
});
import {analyticsPagePath,analyticsPageRows} from '../shared/website-analytics-insights.js';
test('private document tokens and query strings are masked while page totals remain intact',()=>{
 assert.equal(analyticsPagePath('/invoice/private-document-token?email=private@example.invalid'),'/invoice/[private]');
 assert.equal(analyticsPagePath('/%70roposal/private-token'),'/proposal/[private]');
 assert.equal(analyticsPagePath('/availability?email=private@example.invalid'),'/availability');
 assert.deepEqual(analyticsPageRows([{pagePath:'/invoice/token-a',screenPageViews:2},{pagePath:'/invoice/token-b',screenPageViews:3}], 'pagePath','screenPageViews'),[{pagePath:'/invoice/[private]',screenPageViews:5}]);
});
