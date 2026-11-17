import test from 'node:test';
import assert from 'node:assert/strict';
import { ref2vaSourceText, ref2vaEconomyFeedback } from './ref2vaAuthoring.ts';
import { buildShotRewriteFacts } from './shotRewriteContext.ts';
test('structured reconstruction excludes both old shot prose and preceding generated prose', () => {
  const shot = { shotNo: '01-01', description: 'Two people sit beside the table', characterIds: [], propIds: [] } as any;
  const facts = buildShotRewriteFacts({ characters: [], props: [] } as any, shot, 'OBSOLETE LONG DRAFT', { shotNo: '00-01', exitState: { props: 'laptop closed' }, universalVideoPrompt: 'OBSOLETE PREDECESSOR' } as any);
  const request = ref2vaSourceText({ factualContext: facts, prompt: 'OBSOLETE LONG DRAFT', rewriteMode: 'reconstruct' });
  assert.doesNotMatch(request, /OBSOLETE/);
  assert.match(request, /Two people sit beside the table/);
  assert.match(request, /laptop closed/);
});
test('free-form callers and legacy-only shots retain their sole factual source', () => {
  assert.match(ref2vaSourceText({ prompt: 'Keep my handwritten action' }), /Keep my handwritten action/);
  const facts = buildShotRewriteFacts({ characters: [], props: [] } as any, { shotNo: '01-01', characterIds: [], propIds: [] } as any, 'Only available story');
  assert.match(facts, /Only available story/);
});
test('editorial review flags overlong descriptions without treating exact speech as padding', () => {
  assert.equal(ref2vaEconomyFeedback('room costume '.repeat(500), 5, 4).length, 1);
  assert.equal(ref2vaEconomyFeedback('A quiet wide shot. <d>[Chinese] '+ 'long speech '.repeat(600) + '</d>', 5, 4).length, 0);
  assert.equal(ref2vaEconomyFeedback('action '.repeat(600), 30, 6).length, 0);
});

test('explicit editing retains user-authored changes even with canonical facts', () => {
  const result = ref2vaSourceText({ factualContext: 'Original script', prompt: 'User camera instructions', rewriteMode: 'edit' });
  assert.match(result, /Original script/);
  assert.match(result, /User camera instructions/);
});
