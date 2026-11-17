import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DSH_FALLBACK_CONTEXT_WINDOW,
  resolveDshContextWindow,
  resolveDshProviderRouting,
} from './providerProtocol.ts';

test('Anthropic-compatible providers route through anthropic-messages', () => {
  for (const providerId of ['glm', 'kimi', 'minimax', 'qwen', 'doubao']) {
    const routing = resolveDshProviderRouting({ providerId });
    assert.equal(routing?.protocol, 'anthropic-messages', providerId);
    assert.ok(routing?.baseUrl, `${providerId} must carry a default base URL`);
  }
});

test('DeepSeek and custom routes speak openai-completions', () => {
  assert.equal(
    resolveDshProviderRouting({ providerId: 'deepseek' })?.protocol,
    'openai-completions',
  );
  assert.equal(
    resolveDshProviderRouting({ providerId: 'custom' })?.protocol,
    'openai-completions',
  );
});

test('a configured base URL wins over the built-in default', () => {
  const routing = resolveDshProviderRouting({
    providerId: 'custom',
    baseUrl: 'http://127.0.0.1:4317/openai/v1/',
  });
  // pi-ai appends the protocol path itself, so only the trailing slash is
  // normalised away — a provider path segment like /openai/v1 must survive.
  assert.equal(routing?.baseUrl, 'http://127.0.0.1:4317/openai/v1');
});

test('an unknown provider yields no routing so the turn stays on the built-in chain', () => {
  assert.equal(resolveDshProviderRouting({ providerId: 'not-a-provider' }), undefined);
  assert.equal(resolveDshProviderRouting({ providerId: '   ' }), undefined);
});

test('a blank configured base URL falls back to the provider default', () => {
  const routing = resolveDshProviderRouting({ providerId: 'glm', baseUrl: '   ' });
  assert.equal(routing?.baseUrl, 'https://open.bigmodel.cn/api/anthropic');
});

test('a declared context window is passed through unchanged', () => {
  // Doubao is 256K and GLM-5.1 is 128K: declaring the runtime a larger window
  // than the endpoint really has suppresses compaction until the request is
  // rejected outright.
  assert.equal(resolveDshContextWindow(256_000), 256_000);
  assert.equal(resolveDshContextWindow(128_000), 128_000);
  assert.equal(resolveDshContextWindow(1_000_000), 1_000_000);
});

test('an unknown context window uses the explicit fallback', () => {
  for (const unknown of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(resolveDshContextWindow(unknown), DSH_FALLBACK_CONTEXT_WINDOW, String(unknown));
  }
});

test('a wire model id is sent when the picker label differs (Kimi 1M tier)', () => {
  // Kimi grants 1M context by account, so `k3[1m]` is a label while `k3` is
  // the id the endpoint accepts. Verified against a live request capture:
  // sending `k3[1m]` verbatim is rejected.
  assert.equal(
    resolveDshProviderRouting({ providerId: 'kimi', modelId: 'k3[1m]' })?.wireModelId,
    'k3',
  );
  assert.equal(
    resolveDshProviderRouting({ providerId: 'kimi', modelId: 'k3' })?.wireModelId,
    'k3',
  );
});

test('other providers send the picked model id unchanged', () => {
  assert.equal(
    resolveDshProviderRouting({ providerId: 'glm', modelId: 'glm-5.3' })?.wireModelId,
    'glm-5.3',
  );
  assert.equal(
    resolveDshProviderRouting({ providerId: 'custom', modelId: 'deepseek-v4.1-flash' })?.wireModelId,
    'deepseek-v4.1-flash',
  );
});

test('only Bearer-authenticating gateways request the Authorization header', () => {
  // Verified against a live request capture: pi-ai's anthropic-messages path
  // emits `x-api-key` only, so Qwen/Ark answer 401 without this.
  assert.equal(resolveDshProviderRouting({ providerId: 'qwen' })?.sendBearerAuth, true);
  assert.equal(resolveDshProviderRouting({ providerId: 'doubao' })?.sendBearerAuth, true);
  assert.equal(resolveDshProviderRouting({ providerId: 'glm' })?.sendBearerAuth, false);
  assert.equal(resolveDshProviderRouting({ providerId: 'kimi' })?.sendBearerAuth, false);
  assert.equal(resolveDshProviderRouting({ providerId: 'deepseek' })?.sendBearerAuth, undefined);
});

test('custom Gateway normalizes root and full endpoint without losing its prefix', () => {
  for (const [input, expected] of [
    ['http://127.0.0.1:4317', 'http://127.0.0.1:4317/v1'],
    ['http://127.0.0.1:4317/openai/v1/chat/completions/', 'http://127.0.0.1:4317/openai/v1'],
    ['http://127.0.0.1:4317/openai/v1/responses', 'http://127.0.0.1:4317/openai/v1'],
  ]) {
    assert.equal(resolveDshProviderRouting({ providerId: 'custom', baseUrl: input })?.baseUrl, expected);
  }
});

test('DeepSeek Gateway normalizes root and full endpoint before pi-ai appends the path', () => {
  for (const [input, expected] of [
    ['http://127.0.0.1:30377', 'http://127.0.0.1:30377/v1'],
    ['http://127.0.0.1:30377/v1/', 'http://127.0.0.1:30377/v1'],
    ['http://127.0.0.1:30377/v1/chat/completions', 'http://127.0.0.1:30377/v1'],
  ]) {
    assert.equal(resolveDshProviderRouting({ providerId: 'deepseek', baseUrl: input })?.baseUrl, expected);
  }
});
