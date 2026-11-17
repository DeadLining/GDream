import { normalizeOpenAIBaseUrl } from '../providers/customOpenAIUrl.ts';

/**
 * Maps a GDream chat provider onto the wire protocol the generic pi-ai
 * adapter inside the DSH runtime must speak.
 *
 * The DSH runtime used to be DeepSeek-only: `dsh_start` hard-coded the
 * `llm-deepseek` plugin, so choosing Harness silently pinned the turn to the
 * DeepSeek endpoint even when the composer showed another channel. The runtime
 * ships `@deepseek-ai/dsh-llm-pi-ai`, whose three supported protocols cover
 * every backend GDream already stores, so the mapping lives here instead of in
 * a hard-coded engine list.
 *
 * Zero dependencies on purpose: `node --test` loads this file directly, and
 * the hook that consumes it must not drag Tauri into a unit test.
 */

/** Exactly the protocol names `supportedProtocols()` reports in the runtime. */
export type DshProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

export interface DshProviderRouting {
  protocol: DshProtocol;
  /**
   * Base URL handed to pi-ai. pi-ai appends the protocol's own path
   * (`/chat/completions`, `/responses`, `/v1/messages`), so this stays the
   * endpoint as configured — it must NOT be normalised into an OpenAI root.
   */
  baseUrl: string;
  /**
   * Model id to send on the wire. Kimi grants 1M context by account, so
   * `k3[1m]` is a picker label while `k3` is what the endpoint accepts.
   * Defaults to the picked model id.
   */
  wireModelId: string;
  /**
   * Whether the gateway also needs `Authorization: Bearer`. pi-ai's
   * `anthropic-messages` path only ever sends `x-api-key` and cannot be
   * switched, so Qwen and Ark would answer 401 without an explicit header.
   */
  sendBearerAuth?: boolean;
}

export interface DshRoutingInput {
  providerId: string;
  /** Configured base URL, falling back to the provider's default. */
  baseUrl?: string;
  modelId?: string;
}

/**
 * Fallback context window when the caller cannot name the model's real one.
 * Only a last resort: declaring a window larger than the endpoint's actual
 * limit means compaction never triggers, so the session grows past the real
 * ceiling and the request hard-fails instead of being summarised.
 */
export const DSH_FALLBACK_CONTEXT_WINDOW = 200_000;

/**
 * Context window handed to the runtime for compaction. `0`, `NaN` and
 * `undefined` all mean "unknown", and an unknown window must resolve to the
 * configured fallback; callers should supply the actual model limit.
 */
export function resolveDshContextWindow(declaredContextWindow?: number): number {
  return typeof declaredContextWindow === 'number'
    && Number.isFinite(declaredContextWindow)
    && declaredContextWindow > 0
    ? declaredContextWindow
    : DSH_FALLBACK_CONTEXT_WINDOW;
}

/**
 * Providers GDream registers as Anthropic-Messages endpoints. GLM, Kimi and
 * the ANTHROPIC_PRESETS all talk `/v1/messages` through GLMClient, so they
 * share one protocol here.
 */
const ANTHROPIC_MESSAGES_PROVIDERS = new Set(['glm', 'kimi', 'minimax', 'qwen', 'doubao']);

const DEFAULT_BASE_URLS: Record<string, string> = {
  glm: 'https://open.bigmodel.cn/api/anthropic',
  kimi: 'https://api.kimi.com/coding',
  minimax: 'https://api.minimaxi.com/anthropic',
  qwen: 'https://dashscope.aliyuncs.com/apps/anthropic',
  doubao: 'https://ark.cn-beijing.volces.com/api/compatible',
  deepseek: 'https://api.deepseek.com/v1',
  custom: 'http://127.0.0.1:8000/v1',
};

/**
 * Providers whose gateway authenticates with `Authorization: Bearer` in
 * addition to (or instead of) Anthropic's `x-api-key`. Mirrors the
 * `auth: 'both'` flag on GDream's own ANTHROPIC_PRESETS.
 */
const BEARER_AUTH_PROVIDERS = new Set(['qwen', 'doubao']);

// Thinking levels are deliberately not part of this contract: the accepted
// effort key is provider-specific, and pi-ai fails the whole turn when a model
// is handed an effort it does not declare. DeepSeek's thinking is wired in
// Rust by its dedicated adapter; pi-ai routes stream reasoning when their
// endpoint emits it unprompted.

/**
 * Resolve the pi-ai routing for a provider, or `undefined` when GDream has no
 * confirmed protocol for it. Returning `undefined` is deliberate: the caller
 * falls back to the built-in execution chain instead of guessing a protocol
 * and failing mid-turn.
 */
export function resolveDshProviderRouting(input: DshRoutingInput): DshProviderRouting | undefined {
  const providerId = input.providerId?.trim();
  if (!providerId) return undefined;
  const baseUrl = (input.baseUrl?.trim() || DEFAULT_BASE_URLS[providerId] || '').replace(/\/+$/, '');
  if (!baseUrl) return undefined;
  const requestedModel = input.modelId?.trim() || '';
  if (ANTHROPIC_MESSAGES_PROVIDERS.has(providerId)) {
    return {
      protocol: 'anthropic-messages',
      baseUrl,
      // Kimi's 1M tier is an account capability, not a distinct wire model.
      wireModelId: providerId === 'kimi' && /^k3(?:\[1m\])?$/i.test(requestedModel) ? 'k3' : requestedModel,
      sendBearerAuth: BEARER_AUTH_PROVIDERS.has(providerId),
    };
  }
  if (providerId === 'deepseek' || providerId === 'custom') {
    return {
      protocol: 'openai-completions',
      baseUrl: normalizeOpenAIBaseUrl(baseUrl),
      wireModelId: requestedModel,
    };
  }
  return undefined;
}
