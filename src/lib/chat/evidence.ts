/** Only evidence is sanitized. Original user input is stored separately and remains lossless. */
const HIDDEN = '[已隐藏]';
const sensitiveKey = /^(?:api[_-]?key|secret(?:[_-]?key)?|client[_-]?secret|password|passwd|authorization|proxy[_-]?authorization|access[_-]?token|refresh[_-]?token|token|credentials?|signature|x[_-]?api[_-]?key|x-amz-(?:credential|signature|security-token)|x-goog-(?:credential|signature))$/i;
const fieldName = '(?:api[_-]?key|secret(?:[_-]?key)?|client[_-]?secret|password|passwd|authorization|proxy[_-]?authorization|access[_-]?token|refresh[_-]?token|token|credentials?|signature|x[_-]?api[_-]?key)';
const assignment = new RegExp(`(\\b${fieldName}["']?\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|(?:Basic|Bearer)\\s+[^\\s,;"'}]+|[^\\s,;"'}]+)`, 'gi');

export function safeEvidence(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Tool output is commonly a JSON string (sometimes nested inside another JSON field).
    if (/^[{["]/.test(trimmed)) {
      try {
        const decoded: unknown = JSON.parse(trimmed);
        const clean = safeEvidence(decoded);
        // Keep formatting and business text exactly when no sanitization is needed.
        if (JSON.stringify(clean) === JSON.stringify(decoded)) return value;
        return JSON.stringify(clean);
      } catch { /* Mixed logs and malformed/truncated JSON use the text fallback. */ }
    }
    return value
      .replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/g, '[内联媒体未写入日志]')
      .replace(/\b(Bearer|Basic)\s+[^\s"']+/gi, `$1 ${HIDDEN}`)
      .replace(/([?&](?:api[_-]?key|key|token|signature|credential|x-amz-(?:credential|signature|security-token)|x-goog-(?:credential|signature))=)[^&\s"']+/gi, `$1${HIDDEN}`)
      .replace(assignment, (_match, prefix: string) => `${prefix}"${HIDDEN}"`);
  }
  if (Array.isArray(value)) return value.map(safeEvidence);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      sensitiveKey.test(key) ? HIDDEN : safeEvidence(item)]));
  }
  return value;
}
