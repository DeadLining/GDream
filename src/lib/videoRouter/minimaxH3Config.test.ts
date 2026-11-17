import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLegacyMinimaxH3Endpoint,
  migrateMinimaxH3Endpoint,
  MINIMAX_H3_DEFAULT_ENDPOINT,
} from './minimaxH3Config.ts';

test('recognizes every historical built-in MiniMax H3 endpoint', () => {
  for (const endpoint of [
    'http://localhost:30010',
    'http://127.0.0.1:30010',
    'http://127.0.0.1:7861',
    'http://127.0.0.1:7861/',
  ]) {
    assert.equal(isLegacyMinimaxH3Endpoint(endpoint), true);
    assert.equal(migrateMinimaxH3Endpoint(endpoint), MINIMAX_H3_DEFAULT_ENDPOINT);
  }
});

test('does not rewrite a user-provided MiniMax H3 endpoint', () => {
  const endpoint = 'http://192.0.2.42:7863/';
  assert.equal(isLegacyMinimaxH3Endpoint(endpoint), false);
  assert.equal(migrateMinimaxH3Endpoint(endpoint), 'http://192.0.2.42:7863');
});

test('normalizes empty and whitespace-only endpoints without inventing a remote host', () => {
  assert.equal(migrateMinimaxH3Endpoint(''), '');
  assert.equal(migrateMinimaxH3Endpoint('   '), '');
  assert.equal(migrateMinimaxH3Endpoint(undefined), '');
});
