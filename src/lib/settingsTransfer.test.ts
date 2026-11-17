import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeSettingsExportPayload,
  sanitizeSettingsImportPayload,
} from './settingsTransfer.ts';

test('设置导出始终移除凭证注册表、引用和旧平铺密钥', () => {
  const exported = sanitizeSettingsExportPayload({
    theme: 'dark',
    qualityReviewModel: 'review-model',
    glmApiKey: 'secret-glm',
    cosSecretId: 'secret-id',
    cosSecretKey: 'secret-key',
    providerApiKeys: { deepseek: 'secret-provider' },
    imageApiSlots: [{ id: 'slot-1', apiKey: 'secret-slot' }],
    credentials: [{ id: 'cred-1', apiKey: 'secret-registry' }],
    credentialRefs: { qualityReview: 'cred-1' },
  });

  assert.deepEqual(exported, {
    theme: 'dark',
    qualityReviewModel: 'review-model',
  });
  assert.equal(JSON.stringify(exported).includes('secret'), false);
});

test('设置导出移除会话状态和函数', () => {
  assert.deepEqual(sanitizeSettingsExportPayload({
    setupComplete: true,
    deletedSessionIds: ['session-1'],
    sessionLastReadAt: { 'session-1': 1 },
    sessionTitles: { 'session-1': 'title' },
    setSetupComplete: () => undefined,
  }), { setupComplete: true });
});

test('设置导入只接收当前 store 已知字段并忽略会话状态', () => {
  const imported = sanitizeSettingsImportPayload({
    theme: 'light',
    credentials: [{ id: 'cred-1', apiKey: 'legacy-backup-key' }],
    deletedSessionIds: ['session-1'],
    unknown: 'drop-me',
  }, new Set(['theme', 'credentials', 'deletedSessionIds']));

  assert.deepEqual(imported, {
    theme: 'light',
    credentials: [{ id: 'cred-1', apiKey: 'legacy-backup-key' }],
  });
});

test('设置传输拒绝非对象载荷', () => {
  assert.throws(() => sanitizeSettingsExportPayload(null), /有效的GDream设置 JSON/);
  assert.throws(() => sanitizeSettingsImportPayload('bad', new Set()), /有效的GDream设置 JSON/);
});


test('obsolete engine fields never pass export or import even if present in current state', () => {
 const input={deepseekEngine:'builtin',theme:'dark'};
 assert.deepEqual(sanitizeSettingsExportPayload(input),{theme:'dark'});
 assert.deepEqual(sanitizeSettingsImportPayload(input,new Set(Object.keys(input))),{theme:'dark'});
});
