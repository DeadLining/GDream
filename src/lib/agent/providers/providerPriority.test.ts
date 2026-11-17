import test from 'node:test';
import assert from 'node:assert/strict';
import { moveProviderToIndex, orderedProviderIds } from './providerPriority.ts';

const known = ['custom', 'glm', 'deepseek', 'kimi', 'minimax'];

test('priority order starts with the effective default and never duplicates providers', () => {
  assert.deepEqual(
    orderedProviderIds('deepseek', ['glm', 'deepseek', 'kimi'], known),
    ['deepseek', 'glm', 'kimi', 'custom', 'minimax'],
  );
});

test('dropping upward moves the provider before the target', () => {
  assert.deepEqual(
    moveProviderToIndex(['custom', 'glm', 'deepseek', 'kimi'], 'deepseek', 'glm'),
    ['custom', 'deepseek', 'glm', 'kimi'],
  );
});

test('dropping downward moves the provider to the target index', () => {
  assert.deepEqual(
    moveProviderToIndex(['deepseek', 'glm', 'kimi', 'custom'], 'deepseek', 'kimi'),
    ['glm', 'kimi', 'deepseek', 'custom'],
  );
});

test('an unknown target leaves the order unchanged', () => {
  assert.deepEqual(
    moveProviderToIndex(['deepseek', 'glm'], 'deepseek', 'missing'),
    ['deepseek', 'glm'],
  );
});
