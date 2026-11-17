/** Removed preferences must not re-enter via same-version files or imports. */
export function stripObsoleteSettings<T extends Record<string, unknown>>(state: T): T {
  const clean = { ...state };
  delete clean.deepseekEngine;
  delete clean.setDeepseekEngine;
  delete clean.maxTurns;
  delete clean.setMaxTurns;
  return clean;
}
