import { stripObsoleteSettings } from './obsoleteSettings.ts';
const SETTINGS_EXPORT_SESSION_KEYS = new Set([
  'deletedSessionIds',
  'sessionLastReadAt',
  'sessionTitles',
]);

const SETTINGS_EXPORT_CREDENTIAL_KEYS = new Set([
  'providerApiKeys',
  'imageApiSlots',
  'credentials',
  'credentialRefs',
]);

function isCredentialBearingKey(key: string): boolean {
  return SETTINGS_EXPORT_CREDENTIAL_KEYS.has(key)
    || /(apiKey|secretKey|secretId|accessToken|refreshToken|authToken)$/i.test(key);
}

function assertSettingsObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') {
    throw new Error('文件不是有效的GDream设置 JSON');
  }
  return input as Record<string, unknown>;
}

export function sanitizeSettingsExportPayload(input: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(stripObsoleteSettings(assertSettingsObject(input))).filter(([key, value]) => (
      typeof value !== 'function'
      && !SETTINGS_EXPORT_SESSION_KEYS.has(key)
      && !isCredentialBearingKey(key)
    )),
  );
}

export function sanitizeSettingsImportPayload(
  input: unknown,
  allowedKeys: Set<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(stripObsoleteSettings(assertSettingsObject(input))).filter(([key, value]) => (
      typeof value !== 'function'
      && !SETTINGS_EXPORT_SESSION_KEYS.has(key)
      && allowedKeys.has(key)
    )),
  );
}

