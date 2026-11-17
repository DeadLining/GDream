import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowGenerationHistory } from './generationHistoryPresentation.ts';

test('hides the history strip when there is only one version', () => {
  assert.equal(shouldShowGenerationHistory([]), false);
  assert.equal(shouldShowGenerationHistory([{ url: 'one' }]), false);
});

test('shows the history strip when multiple versions exist', () => {
  assert.equal(shouldShowGenerationHistory([{ url: 'one' }, { url: 'two' }]), true);
});
