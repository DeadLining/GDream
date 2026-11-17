export type ParsedToolArguments =
  | { ok: true; value: Record<string, unknown>; repaired: boolean }
  | { ok: false; error: string; repaired: boolean };

function findJsonEnd(raw: string): number {
  const start = raw.search(/\S/);
  if (start < 0) return -1;
  const first = raw[start];
  if (first !== '{' && first !== '[') return -1;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return raw.length;
}

function isEscaped(raw: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && raw[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

/**
 * Repair only one narrow, observed model-output failure: a double quote inside
 * a JSON string that should have been escaped, usually an inner dialogue quote.
 *
 * A quote closes a string only when the next non-whitespace token can legally
 * follow a JSON value (`,`, `}`, `]`, or end of input). Anything else is kept
 * as content. The result is still accepted only if JSON.parse validates it.
 */
export function repairUnescapedStringQuotes(raw: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (!inString) {
      out += ch;
      if (ch === '"' && !isEscaped(raw, i)) inString = true;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch !== '"') {
      out += ch;
      continue;
    }

    let next = i + 1;
    while (next < raw.length && /\s/.test(raw[next])) next += 1;
    const token = raw[next];
    // A quote only closes a JSON string when the next token can legally
    // follow a value. Inner dialogue followed by a CJK character or
    // punctuation is content and must be escaped.
    const closesString = token === undefined
      || token === ':'
      || token === ','
      || token === '}'
      || token === ']';
    if (closesString) {
      out += ch;
      inString = false;
    } else {
      out += '\\"';
    }
  }
  return out;
}

export function parseToolArguments(raw: string): ParsedToolArguments {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: '工具参数为空。', repaired: false };

  const end = findJsonEnd(trimmed);
  const candidate = end >= 0 ? trimmed.slice(0, end) : trimmed;
  try {
    const value = JSON.parse(candidate) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: '工具参数必须是 JSON 对象。', repaired: false };
    }
    return { ok: true, value: value as Record<string, unknown>, repaired: false };
  } catch (originalError) {
    const repairedCandidate = repairUnescapedStringQuotes(candidate);
    try {
      const value = JSON.parse(repairedCandidate) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, error: '工具参数必须是 JSON 对象。', repaired: true };
      }
      return { ok: true, value: value as Record<string, unknown>, repaired: true };
    } catch {
      const message = originalError instanceof Error ? originalError.message : String(originalError);
      return { ok: false, error: `工具参数不是合法 JSON：${message}`, repaired: false };
    }
  }
}

export interface NormalizedWorkshopArrayParam {
  value: unknown[] | undefined;
  recovered: boolean;
  error?: string;
}

/** Accept only the observed double-encoding form; never guess arbitrary text. */
export function normalizeWorkshopArrayParam(
  value: unknown,
  name: string,
): NormalizedWorkshopArrayParam {
  if (Array.isArray(value)) return { value, recovered: false };
  // Absent means "not part of this call", which is legal for a partial update.
  if (value === undefined || value === null) return { value: undefined, recovered: false };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return { value: parsed, recovered: true };
    } catch {
      // Fall through to the precise parameter error below.
    }
    return {
      value: undefined,
      recovered: false,
      error: `${name} 必须是数组；收到的是无法解析的字符串。`,
    };
  }
  return {
    value: undefined,
    recovered: false,
    error: `${name} 必须是数组；收到的是 ${typeof value}。`,
  };
}

export type PreparedToolCallArguments =
  | { ok: true; params: Record<string, unknown>; repaired: boolean }
  | { ok: false; error: string; repaired: boolean };

/**
 * Convert raw model tool arguments into either executable params or an explicit
 * tool error. A JSON parse failure must never be converted to `{}` and sent to
 * a tool: that changes a transport/serialization failure into a misleading
 * business-validation failure and hides the model's real defect.
 */
export function prepareToolCallArguments(
  toolName: string,
  raw: string,
): PreparedToolCallArguments {
  const parsed = parseToolArguments(raw);
  if (parsed.ok) return { ok: true, params: parsed.value, repaired: parsed.repaired };
  return {
    ok: false,
    error: `工具 ${toolName} 的参数解析失败：${parsed.error}。请重新调用该工具，并输出合法 JSON；字符串中的双引号必须转义。`,
    repaired: parsed.repaired,
  };
}
