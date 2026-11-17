import assert from 'node:assert/strict';
import test from 'node:test';
import { workshopBreakdownRequiredFields } from './breakdownSchema.ts';

test('first workshop breakdown requires the full structured contract', () => {
  const required = workshopBreakdownRequiredFields({ hasExistingBreakdown: false, hasSourceMaterial: false });
  assert.deepEqual(required, ['synopsis', 'episodes', 'narrativeBeats', 'characters', 'scenes']);
});

test('first breakdown from a source script also requires sourceEvidence', () => {
  const required = workshopBreakdownRequiredFields({ hasExistingBreakdown: false, hasSourceMaterial: true });
  assert.deepEqual(required, ['synopsis', 'episodes', 'narrativeBeats', 'characters', 'scenes', 'sourceEvidence']);
});

test('a partial re-analysis of an existing breakdown only requires synopsis', () => {
  const required = workshopBreakdownRequiredFields({ hasExistingBreakdown: true, hasSourceMaterial: true });
  assert.deepEqual(required, ['synopsis']);
  const requiredNoSource = workshopBreakdownRequiredFields({ hasExistingBreakdown: true, hasSourceMaterial: false });
  assert.deepEqual(requiredNoSource, ['synopsis']);
});
