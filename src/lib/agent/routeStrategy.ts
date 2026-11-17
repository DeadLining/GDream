import type { RouteStrategy } from './providers/router';
// 相对路径 + .ts 后缀：node --test 直接加载本文件时无法解析 '@/' 别名
import { resolveApiKey, type CredentialHostState } from '../credentials.ts';
// registry 只依赖类型，可以安全地在纯函数里查展示名（测试里未注册时回退到 id）
import { getProvider } from './providers/registry.ts';

export interface RouteSettingsSnapshot extends CredentialHostState {
  providerApiKeys?: Record<string, string>;
  providerModels?: Record<string, string>;
  providerDefault?: string;
  providerFallbackChain?: string[];
}

export interface RouteSelection {
  providerId: string;
  modelId?: string;
}

export interface BuildRouteOptions {
  legacyGlmApiKey?: string;
  /** Explicit selection made in the current surface, such as a workspace picker. */
  primary?: RouteSelection | null;
  /** Old per-agent preference kept only as a recovery path for migrated settings. */
  legacyAgentPreference?: string;
}

function hasProviderKey(
  settings: RouteSettingsSnapshot,
  providerId: string,
  legacyGlmApiKey?: string,
): boolean {
  const providerApiKeys = settings.providerApiKeys ?? {};
  const legacy = providerId === 'glm'
    ? (providerApiKeys.glm ?? legacyGlmApiKey)
    : providerApiKeys[providerId];
  // 凭证注册表优先，旧 providerApiKeys 字段回退
  return Boolean(resolveApiKey(settings, `provider:${providerId}`, legacy ?? '').trim());
}

export interface SkippedRouteCandidate {
  providerId: string;
  /** 目前只有缺 key 一种，显式写出来便于以后扩展。 */
  reason: 'missing-key';
}

export interface ChatRoutePlan {
  /** 没有任何候选渠道有可用凭证时为 undefined。 */
  strategy?: RouteStrategy;
  /** 按考虑顺序记录被剔除的候选渠道。 */
  skipped: SkippedRouteCandidate[];
  /** 当前界面选中的渠道（模型选择器 / 全局默认）。 */
  selectedProviderId: string;
  /** 选中渠道因为缺 key 被剔除——本次会在别的渠道上跑。 */
  selectionSkipped: boolean;
  /** 仅在 strategy 为 undefined 时给出：可直接展示给用户的原因与处置建议。 */
  blockedReason?: string;
}

function providerLabel(providerId: string): string {
  return getProvider(providerId)?.displayName?.trim() || providerId;
}

function describeBlockedRoute(selectedProviderId: string, skipped: SkippedRouteCandidate[]): string {
  const tried = skipped.map((item) => providerLabel(item.providerId));
  const scope = tried.length > 0
    ? `已尝试的渠道（${tried.join('、')}）都没有可用的 API Key`
    : '当前没有配置任何对话渠道';
  return `没有可用的对话渠道：${scope}。\n`
    + `当前选择的渠道是「${providerLabel(selectedProviderId)}」。`
    + '请到「设置 → API 密钥」为其中至少一个渠道填入 Key，'
    + '或先把模型选择器切换到已经配置好的渠道。';
}

/**
 * Build one deterministic route from the visible model selection, together with
 * the diagnostics needed to explain a degraded outcome.
 *
 * Priority is deliberately user-facing: current-surface selection, then the
 * explicit fallback list. A migrated per-agent preference must never silently
 * override the model shown in the composer; it is consulted only when the
 * visible primary has no usable key.
 *
 * Missing keys used to be dropped silently, which produced two confusing
 * behaviours: a chain that quietly collapsed to a single provider (the user's
 * selected channel replaced by whichever fallback happened to have a key), and
 * an empty chain that callers turned into a hard-coded DeepSeek route. Callers
 * must now consult `skipped` / `blockedReason` and tell the user.
 */
export function buildChatRoutePlan(
  settings: RouteSettingsSnapshot,
  options: BuildRouteOptions = {},
): ChatRoutePlan {
  const chain: RouteSelection[] = [];
  const skipped: SkippedRouteCandidate[] = [];
  const seen = new Set<string>();
  const add = (selection: RouteSelection | null | undefined): boolean => {
    const providerId = selection?.providerId?.trim();
    if (!providerId || seen.has(providerId)) return false;
    // 先登记再判 key：同一个渠道不必因为被剔除而重复记录。
    seen.add(providerId);
    if (!hasProviderKey(settings, providerId, options.legacyGlmApiKey)) {
      skipped.push({ providerId, reason: 'missing-key' });
      return false;
    }
    chain.push({
      providerId,
      modelId: selection?.modelId || settings.providerModels?.[providerId] || undefined,
    });
    return true;
  };

  const visiblePrimary = options.primary ?? {
    providerId: settings.providerDefault || 'deepseek',
  };
  const selectedProviderId = visiblePrimary.providerId?.trim() || '';
  const hasVisiblePrimary = add(visiblePrimary);
  const selectionSkipped = skipped.some((item) => item.providerId === selectedProviderId);

  // Backward compatibility for old agent metadata. It is intentionally not a
  // hidden override when the current UI selection is valid.
  if (!hasVisiblePrimary && options.legacyAgentPreference) {
    add({ providerId: options.legacyAgentPreference });
  }

  for (const providerId of settings.providerFallbackChain ?? []) {
    add({ providerId });
  }

  if (chain.length >= 2) {
    return { strategy: { kind: 'fallback_chain', chain }, skipped, selectedProviderId, selectionSkipped };
  }
  if (chain.length === 1) {
    return {
      strategy: {
        kind: 'primary',
        providerId: chain[0].providerId,
        modelId: chain[0].modelId,
      },
      skipped,
      selectedProviderId,
      selectionSkipped,
    };
  }
  return {
    skipped,
    selectedProviderId,
    selectionSkipped,
    blockedReason: describeBlockedRoute(selectedProviderId, skipped),
  };
}

/** Strategy-only view of {@link buildChatRoutePlan}. */
export function buildChatRouteStrategy(
  settings: RouteSettingsSnapshot,
  options: BuildRouteOptions = {},
): RouteStrategy | undefined {
  return buildChatRoutePlan(settings, options).strategy;
}

/**
 * 用户可读的降级说明：只有当**界面选中的渠道**因为没有 key 被剔除、
 * 而本次实际跑在别的渠道上时才返回文本。备选渠道缺 key 属于正常剔除，
 * 不影响选中渠道，不应打扰用户。
 */
export function describeRouteDeviation(plan: ChatRoutePlan): string | undefined {
  if (!plan.strategy || !plan.selectionSkipped) return undefined;
  const active = plan.strategy.kind === 'fallback_chain'
    ? plan.strategy.chain[0]?.providerId
    : plan.strategy.kind === 'primary' ? plan.strategy.providerId : undefined;
  if (!active || active === plan.selectedProviderId) return undefined;
  return `所选渠道「${providerLabel(plan.selectedProviderId)}」没有配置 API Key，`
    + `本次改用「${providerLabel(active)}」。`
    + '如需固定使用原渠道，请到「设置 → API 密钥」补上 Key。';
}

export function getPrimaryRouteSelection(strategy: RouteStrategy | undefined): RouteSelection {
  if (!strategy) return { providerId: 'deepseek' };
  if (strategy.kind === 'primary') {
    return { providerId: strategy.providerId, modelId: strategy.modelId };
  }
  if (strategy.kind === 'fallback_chain') {
    return strategy.chain[0] ?? { providerId: 'deepseek' };
  }
  return { providerId: 'deepseek' };
}
