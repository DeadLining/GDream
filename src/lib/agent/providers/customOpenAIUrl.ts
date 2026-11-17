/** Normalize a user-entered OpenAI-compatible API URL to its API root. */
export function normalizeOpenAIBaseUrl(baseUrl?: string): string {
  let normalized = (baseUrl || 'http://127.0.0.1:8000/v1').trim().replace(/\/+$/, '');
  normalized = normalized.replace(/\/(?:chat\/completions|responses|models)$/i, '');
  if (/\/v1(?:\/|$)/i.test(normalized)) return normalized;
  return `${normalized}/v1`;
}

/** Backwards-compatible alias used by the custom-provider settings code. */
export const normalizeCustomOpenAIBaseUrl = normalizeOpenAIBaseUrl;
