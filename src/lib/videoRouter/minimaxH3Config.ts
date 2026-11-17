export const MINIMAX_H3_DEFAULT_ENDPOINT = 'http://127.0.0.1:7863';

const MINIMAX_H3_LEGACY_ENDPOINTS = new Set([
  'http://localhost:30010',
  'http://127.0.0.1:30010',
  'http://127.0.0.1:7861',
]);

function normalizedEndpoint(value: unknown): string {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

export function isLegacyMinimaxH3Endpoint(value: unknown): boolean {
  return MINIMAX_H3_LEGACY_ENDPOINTS.has(normalizedEndpoint(value));
}

export function migrateMinimaxH3Endpoint(value: unknown): string {
  const endpoint = normalizedEndpoint(value);
  return isLegacyMinimaxH3Endpoint(endpoint) ? MINIMAX_H3_DEFAULT_ENDPOINT : endpoint;
}
