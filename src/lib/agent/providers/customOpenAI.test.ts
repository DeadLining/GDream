import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomOpenAIBaseUrl, normalizeOpenAIBaseUrl } from './customOpenAIUrl.ts';

test('normalizes custom OpenAI endpoint URLs to an API root', () => {
  assert.equal(normalizeCustomOpenAIBaseUrl('http://192.0.2.10:14000/'), 'http://192.0.2.10:14000/v1');
  assert.equal(normalizeCustomOpenAIBaseUrl('http://192.0.2.10:14000/v1/'), 'http://192.0.2.10:14000/v1');
  assert.equal(normalizeCustomOpenAIBaseUrl('http://192.0.2.10:14000/v1/responses'), 'http://192.0.2.10:14000/v1');
  assert.equal(normalizeCustomOpenAIBaseUrl('http://192.0.2.10:14000/v1/chat/completions'), 'http://192.0.2.10:14000/v1');
  assert.equal(normalizeCustomOpenAIBaseUrl('http://192.0.2.10:14000/api/v1/models'), 'http://192.0.2.10:14000/api/v1');
});

test('shared OpenAI URL normalization keeps DeepSeek fallback on the /v1 API root', () => {
  assert.equal(normalizeOpenAIBaseUrl('http://127.0.0.1:30377'), 'http://127.0.0.1:30377/v1');
  assert.equal(normalizeOpenAIBaseUrl('http://127.0.0.1:30377/v1/chat/completions'), 'http://127.0.0.1:30377/v1');
});
