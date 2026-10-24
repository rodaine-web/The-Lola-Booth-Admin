import test from 'node:test';
import assert from 'node:assert/strict';
import {proposalReviewEmail} from '../server/src/services/proposal-review-service.js';
import {proposalNarrative} from '../server/src/services/proposal-narrative.js';
import {proposalEditInput} from '../server/src/services/proposal-edit-input.js';

test('only customer-facing proposal notes enter original and updated emails, including copies',()=>{
 for(const scenario of [false,true])for(const sent of [false,true])for(const copy of [false,true]){
  const notes='An 8 × 8 ft space is required.\nTravel to Boston is included below. <script>no()</script>';
  const proposal={client_name:'QA Customer',sent_at:sent?'2030-01-01':null,notes:'PRIVATE INTERNAL',content:{notes:'PRIVATE INTERNAL',customer_notes:scenario?'stale notes':notes,...(scenario?{scenario:{customer_notes:notes}}:{})}};
  const email=proposalReviewEmail(proposal,{copy,url:'https://example.invalid/proposal/qa'});
  assert.ok(email.body.includes(notes));assert.doesNotMatch(email.body,/PRIVATE INTERNAL|stale notes/);
  assert.doesNotMatch(email.html,/<script>/);assert.match(email.html,/&lt;script&gt;/);
  assert.equal(proposalEditInput(proposal).customer_notes,notes);
 }
});
test('plain proposal document narrative uses explicit customer notes and never internal notes',()=>{
 assert.equal(proposalNarrative({content:{customer_notes:'Space answer',notes:'PRIVATE INTERNAL'},notes:'PRIVATE INTERNAL'}).notes,'Space answer');
 assert.doesNotMatch(proposalNarrative({content:{notes:'PRIVATE INTERNAL'}}).notes,/PRIVATE INTERNAL/);
 assert.doesNotMatch(proposalReviewEmail({client_name:'QA',notes:'PRIVATE INTERNAL',content:{}}).body,/PRIVATE INTERNAL/);
});

test('custom email body is escaped and protected links and copy notices remain',()=>{
 const proposal={client_name:'QA',content:{},notes:'PRIVATE INTERNAL'};
 const message='Thank you for your question.\nWe need an 8 by 8 foot space. <script>alert(1)</script>';
 for(const copy of [false,true]){
  const email=proposalReviewEmail(proposal,{copy,emailBody:message,url:'https://example.invalid/proposal/qa'});
  assert.ok(email.body.startsWith(message));assert.match(email.body,/https:\/\/example.invalid\/proposal\/qa/);assert.doesNotMatch(email.html,/<script>/);assert.doesNotMatch(email.body,/PRIVATE INTERNAL/);
  if(copy)assert.match(email.body,/information-only copy/);else assert.match(email.body,/review and accept/);
 }
});
