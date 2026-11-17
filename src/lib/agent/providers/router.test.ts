import test from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableFallbackStatus } from './networkPolicy.ts';
import {
  buildChatRoutePlan,
  buildChatRouteStrategy,
  describeRouteDeviation,
  getPrimaryRouteSelection,
} from '../routeStrategy.ts';
import { formatProviderRouteFailure } from '../routeError.ts';

test('transport status 0 triggers provider fallback', () => {
  assert.equal(isRetryableFallbackStatus(0, [408, 429, 500]), true);
});

test('missing status triggers provider fallback', () => {
  assert.equal(isRetryableFallbackStatus(undefined, [408, 429, 500]), true);
});

test('business 4xx does not trigger provider fallback', () => {
  assert.equal(isRetryableFallbackStatus(400, [408, 429, 500]), false);
});

test('configured retryable HTTP status triggers provider fallback', () => {
  assert.equal(isRetryableFallbackStatus(429, [408, 429, 500]), true);
});

const routingSettings = {
  providerApiKeys: { deepseek: 'deepseek-key', kimi: 'kimi-key' },
  providerModels: { deepseek: 'deepseek-v4-flash', kimi: 'k3[1m]' },
  providerDefault: 'deepseek',
  providerFallbackChain: ['deepseek', 'kimi'],
};

test('visible global selection wins over a migrated agent preference', () => {
  const strategy = buildChatRouteStrategy(routingSettings, {
    legacyAgentPreference: 'kimi',
  });
  assert.deepEqual(getPrimaryRouteSelection(strategy), {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
  });
});

test('workspace selection is the primary route and fallback remains explicit', () => {
  const strategy = buildChatRouteStrategy(
    { ...routingSettings, providerDefault: 'kimi' },
    { primary: { providerId: 'deepseek', modelId: 'deepseek-chat' } },
  );
  assert.equal(strategy?.kind, 'fallback_chain');
  if (strategy?.kind !== 'fallback_chain') return;
  assert.deepEqual(strategy.chain, [
    { providerId: 'deepseek', modelId: 'deepseek-chat' },
    { providerId: 'kimi', modelId: 'k3[1m]' },
  ]);
});

test('global default is not added as a hidden workspace fallback', () => {
  const strategy = buildChatRouteStrategy(
    {
      ...routingSettings,
      providerDefault: 'kimi',
      providerFallbackChain: ['deepseek'],
    },
    { primary: { providerId: 'deepseek', modelId: 'deepseek-chat' } },
  );
  assert.deepEqual(strategy, {
    kind: 'primary',
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
  });
});

test('all providers missing keys yields an explicit reason instead of a silent single-provider route', () => {
  const plan = buildChatRoutePlan({
    providerApiKeys: {},
    providerModels: {},
    providerDefault: 'glm',
    providerFallbackChain: ['kimi', 'minimax'],
  });
  assert.equal(plan.strategy, undefined);
  assert.equal(plan.selectedProviderId, 'glm');
  assert.equal(plan.selectionSkipped, true);
  assert.deepEqual(
    plan.skipped.map((item) => item.providerId),
    ['glm', 'kimi', 'minimax'],
  );
  assert.ok(plan.blockedReason, 'an empty chain must carry a user-facing reason');
  assert.match(plan.blockedReason, /没有可用的对话渠道/);
  assert.match(plan.blockedReason, /glm/);
  assert.match(plan.blockedReason, /kimi/);
  assert.match(plan.blockedReason, /设置 → API 密钥/);
});

test('a selected channel without a key is reported rather than silently replaced', () => {
  const plan = buildChatRoutePlan({
    providerApiKeys: { kimi: 'kimi-key' },
    providerModels: { kimi: 'k3[1m]' },
    providerDefault: 'glm',
    providerFallbackChain: ['kimi'],
  });
  assert.deepEqual(plan.skipped, [{ providerId: 'glm', reason: 'missing-key' }]);
  assert.deepEqual(plan.strategy, { kind: 'primary', providerId: 'kimi', modelId: 'k3[1m]' });
  assert.equal(plan.selectionSkipped, true);
  assert.equal(plan.blockedReason, undefined);
  const notice = describeRouteDeviation(plan);
  assert.ok(notice, 'deviating from the visible selection must be explainable');
  assert.match(notice, /glm/);
  assert.match(notice, /kimi/);
});

test('a keyless fallback behind a healthy primary is not treated as a deviation', () => {
  const plan = buildChatRoutePlan({
    providerApiKeys: { deepseek: 'deepseek-key' },
    providerModels: { deepseek: 'deepseek-v4-flash' },
    providerDefault: 'deepseek',
    providerFallbackChain: ['kimi'],
  });
  assert.deepEqual(plan.skipped, [{ providerId: 'kimi', reason: 'missing-key' }]);
  assert.equal(plan.selectedProviderId, 'deepseek');
  assert.equal(plan.selectionSkipped, false);
  assert.equal(plan.blockedReason, undefined);
  assert.equal(describeRouteDeviation(plan), undefined);
});

test('a channel is reported once even when it appears in both the default and the chain', () => {
  const plan = buildChatRoutePlan({
    providerApiKeys: {},
    providerDefault: 'glm',
    providerFallbackChain: ['glm', 'glm'],
  });
  assert.deepEqual(plan.skipped.map((item) => item.providerId), ['glm']);
});

test('fallback error names both the selected and actual final provider', () => {
  const message = formatProviderRouteFailure([
    {
      providerId: 'deepseek',
      providerName: 'DeepSeek',
      modelId: 'deepseek-v4-flash',
      status: 503,
      message: 'upstream unavailable',
    },
    {
      providerId: 'kimi',
      providerName: 'Kimi',
      modelId: 'k3[1m]',
      status: 401,
      message: 'model id must be k3',
    },
  ]);
  assert.match(message, /主路由 DeepSeek/);
  assert.match(message, /切换至 Kimi/);
  assert.match(message, /HTTP 401/);
  assert.match(message, /model id must be k3/);
});
