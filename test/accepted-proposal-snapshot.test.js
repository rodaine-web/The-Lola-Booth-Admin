import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptedProposalSnapshot} from '../shared/accepted-proposal-snapshot.js';

test('accepted revision wins over the previous published offer nested inside it', () => {
  const old={total:1500,pricing_snapshot:{total:1500},line_items_snapshot:[{unit_price:1500}]};
  const revision={total:1200,pricing_snapshot:{total:1200},line_items_snapshot:[{unit_price:1200}],proposal_snapshot:old};
  assert.equal(acceptedProposalSnapshot(revision),revision);
  assert.equal(acceptedProposalSnapshot({...revision,total:0}).total,0);
});
test('legacy wrapped snapshots remain supported without replacing explicit root values', () => {
  const legacy={total:1200,pricing_snapshot:{total:1200},line_items_snapshot:[]};
  assert.equal(acceptedProposalSnapshot({proposal_snapshot:legacy}),legacy);
  assert.equal(acceptedProposalSnapshot({total:null,proposal_snapshot:legacy}).total,null);
  assert.equal(acceptedProposalSnapshot(null),null);
});
