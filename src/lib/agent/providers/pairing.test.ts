/**
 * sanitizeOpenAIToolPairing — P0 回归测试：abort 持久化的孤儿 tool_calls /
 * tool 结果不得再让 OpenAI 兼容端点每轮 400。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeOpenAIToolPairing } from './pairing.ts';
import type { AgentMessage } from '../types.ts';

const assistantWithCalls = (ids: string[]): AgentMessage =>
  ({
    role: 'assistant',
    content: '调工具',
    tool_calls: ids.map((id) => ({ id, type: 'function', function: { name: 'read_file', arguments: '{}' } })),
  }) as AgentMessage;

const toolResult = (id: string): AgentMessage =>
  ({ role: 'tool', tool_call_id: id, content: 'ok' }) as AgentMessage;

test('complete pairing passes through untouched', () => {
  const messages: AgentMessage[] = [
    { role: 'user', content: 'hi' },
    assistantWithCalls(['a', 'b']),
    toolResult('a'),
    toolResult('b'),
    { role: 'assistant', content: 'done' },
  ];
  const out = sanitizeOpenAIToolPairing(messages) as Array<Record<string, unknown>>;
  assert.equal(out.length, 5);
  assert.ok(Array.isArray(out[1].tool_calls));
  assert.equal(out[2].tool_call_id, 'a');
});

test('abort snapshot: assistant tool_calls with no results are stripped', () => {
  const messages: AgentMessage[] = [
    { role: 'user', content: 'hi' },
    assistantWithCalls(['a']),
  ];
  const out = sanitizeOpenAIToolPairing(messages) as Array<Record<string, unknown>>;
  assert.equal(out.length, 2);
  assert.equal(out[1].tool_calls, undefined);
  assert.equal(out[1].content, '调工具');
});

test('partial results: unanswered calls strip BOTH calls and partial results', () => {
  const messages: AgentMessage[] = [
    { role: 'user', content: 'hi' },
    assistantWithCalls(['a', 'b']),
    toolResult('a'),
    { role: 'user', content: '下一步' },
  ];
  const out = sanitizeOpenAIToolPairing(messages) as Array<Record<string, unknown>>;
  assert.equal(out.length, 3);
  assert.equal(out[1].tool_calls, undefined);
  assert.ok(!out.some((m) => m.role === 'tool'));
});

test('orphan tool result without matching call is dropped', () => {
  const messages: AgentMessage[] = [
    { role: 'user', content: 'hi' },
    toolResult('ghost'),
    { role: 'assistant', content: 'ok' },
  ];
  const out = sanitizeOpenAIToolPairing(messages) as Array<Record<string, unknown>>;
  assert.equal(out.length, 2);
  assert.ok(!out.some((m) => m.role === 'tool'));
});

test('multiple turns are handled independently', () => {
  const messages: AgentMessage[] = [
    assistantWithCalls(['ok1']),
    toolResult('ok1'),
    assistantWithCalls(['bad1']),
    { role: 'assistant', content: 'final' },
  ];
  const out = sanitizeOpenAIToolPairing(messages) as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(out[0].tool_calls));
  assert.equal(out[1].tool_call_id, 'ok1');
  assert.equal(out[2].tool_calls, undefined);
  assert.equal(out[3].content, 'final');
});

test('native user images are converted to OpenAI image_url blocks', () => {
  const out = sanitizeOpenAIToolPairing([{ role: 'user', content: [
    { type: 'text', text: '看图' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } },
    { type: 'image', source: { type: 'url', url: 'https://example.invalid/ref.png' } },
  ] }]);
  assert.deepEqual(out, [{ role: 'user', content: [
    { type: 'text', text: '看图' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } },
    { type: 'image_url', image_url: { url: 'https://example.invalid/ref.png' } },
  ] }]);
});

test('reference tool images survive after all parallel tool results, not inside tool content', () => {
  const withImage: AgentMessage = { role: 'tool', tool_call_id: 'refs', content: '参考图', media: [
    { type: 'image', source: { type: 'url', url: 'https://example.invalid/scene.png' } },
    { type: 'image', source: { type: 'url', url: 'https://example.invalid/person.png' } },
  ] };
  const out = sanitizeOpenAIToolPairing([assistantWithCalls(['refs', 'state']), withImage, toolResult('state')]) as Array<Record<string, unknown>>;
  assert.deepEqual(out.map((m) => m.role), ['assistant', 'tool', 'tool', 'user']);
  assert.deepEqual((out[3].content as Array<Record<string, unknown>>).slice(1), [
    { type: 'image_url', image_url: { url: 'https://example.invalid/scene.png' } },
    { type: 'image_url', image_url: { url: 'https://example.invalid/person.png' } },
  ]);
  const partial = sanitizeOpenAIToolPairing([assistantWithCalls(['refs', 'state']), withImage]);
  assert.equal(partial.length, 1, 'unpaired results must not leak stale images');
});
