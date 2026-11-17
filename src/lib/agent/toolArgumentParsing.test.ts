import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseToolArguments,
  prepareToolCallArguments,
  normalizeWorkshopArrayParam,
} from './toolArgumentParsing.ts';

test('recovers JSON when a model leaves an inner dialogue quote unescaped', () => {
  const malformed = '{"synopsis":"三人建立"道具能用"的规则。","episodes":[{"no":"1","title":"白光"}]}';
  const parsed = parseToolArguments(malformed);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.synopsis, '三人建立"道具能用"的规则。');
  assert.deepEqual(parsed.value.episodes, [{ no: '1', title: '白光' }]);
});

test('does not rewrite structurally valid JSON', () => {
  const raw = '{"path":"/tmp/a.ts","content":"const a = 1;"}';
  const parsed = parseToolArguments(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value, { path: '/tmp/a.ts', content: 'const a = 1;' });
});

test('normalizes an array accidentally emitted as a JSON string', () => {
  const value = '[{"no":"1","title":"白光","sceneList":"教室"}]';
  const normalized = normalizeWorkshopArrayParam(value, 'episodes');
  assert.deepEqual(normalized.value, [{ no: '1', title: '白光', sceneList: '教室' }]);
  assert.equal(normalized.recovered, true);
});

test('keeps a real array unchanged and reports malformed strings', () => {
  const array = [{ no: '1' }];
  assert.deepEqual(normalizeWorkshopArrayParam(array, 'episodes'), {
    value: array,
    recovered: false,
  });
  assert.deepEqual(normalizeWorkshopArrayParam('not json', 'episodes'), {
    value: undefined,
    recovered: false,
    error: 'episodes 必须是数组；收到的是无法解析的字符串。',
  });
});

test('turns unrecoverable malformed arguments into an explicit retryable tool failure', () => {
  const prepared = prepareToolCallArguments(
    'workshop_set_breakdown',
    '{"episodes":[{"no":"1"}], "synopsis":"第一集}',
  );
  assert.equal(prepared.ok, false);
  if (prepared.ok) return;
  assert.match(prepared.error, /工具参数不是合法 JSON/);
  assert.match(prepared.error, /请重新调用该工具/);
});

test('keeps valid tool call arguments executable', () => {
  const prepared = prepareToolCallArguments('read_file', '{"path":"/tmp/a.ts"}');
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.deepEqual(prepared.params, { path: '/tmp/a.ts' });
});

test('absent optional arrays are not treated as errors', () => {
  assert.deepEqual(normalizeWorkshopArrayParam(undefined, 'props'), { value: undefined, recovered: false });
  assert.deepEqual(normalizeWorkshopArrayParam(null, 'props'), { value: undefined, recovered: false });
});

test('a non-array, non-string value reports a precise type error', () => {
  const result = normalizeWorkshopArrayParam({}, 'episodes');
  assert.equal(result.value, undefined);
  assert.equal(result.error, 'episodes 必须是数组；收到的是 object。');
});
