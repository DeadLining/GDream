/** Shared DSH-only entry point for auxiliary text tasks. Never runs generation tools. */
import { homeDir } from '@tauri-apps/api/path';
import type { RouteStrategy } from './providers/router';
import { getProvider } from './providers/registry';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { buildChatRoutePlan, getPrimaryRouteSelection, type ChatRoutePlan } from './routeStrategy';
import { decodeChatModel, type AgentWorkspaceScope } from './modelCatalog';
import { DshAcpClient } from './dsh/acpClient';
import { resolveDshContextWindow, resolveDshProviderRouting } from './dsh/providerProtocol';
import { parseDshStreamUpdate } from './dsh/streamUpdate';
import { runDshText, type TextRunOptions } from './dsh/textRun';

/** 从 settings 构建路由计划（与 useAgent 的 buildRoutePlan 同逻辑，含缺 key 诊断）。 */
function buildRoutePlan(
  preferredProviderId?: string,
  pinned?: { providerId: string; modelId: string } | null,
): ChatRoutePlan {
  const s = useSettingsStore.getState();
  return buildChatRoutePlan(s, {
    legacyGlmApiKey: s.glmApiKey,
    primary: pinned ?? (preferredProviderId ? { providerId: preferredProviderId } : null),
  });
}

/** 从 settings 构建 fallback 链策略（与 useAgent 的 buildRouteStrategy 同逻辑）。 */
export function buildRouteStrategyFromSettings(
  preferredProviderId?: string,
  pinned?: { providerId: string; modelId: string } | null,
): RouteStrategy | undefined {
  return buildRoutePlan(preferredProviderId, pinned).strategy;
}

export interface QuickChatOptions extends TextRunOptions {
  preferredProviderId?: string;
  workspaceScope?: AgentWorkspaceScope;
  maxTokens?: number;
  /** Retained for callers; incomplete output is rejected, never replayed. */
  continueOnTruncation?: boolean;
  maxContinuations?: number;
}
export async function quickChat(
  messages: { role: string; content: string }[],
  opts: QuickChatOptions = {},
): Promise<string> {
  const settings = useSettingsStore.getState();
  const pinned = opts.workspaceScope ? decodeChatModel(settings.workspaceAgentModels[opts.workspaceScope]) : null;
  const plan = buildRoutePlan(opts.preferredProviderId, pinned);
  if (!plan.strategy) throw new Error(plan.blockedReason || '未配置可用的 DSH 模型');
  const primary = getPrimaryRouteSelection(plan.strategy);
  // Do not silently execute text tasks using another configured provider.
  const requested = plan.selectedProviderId;
  if (primary.providerId !== requested) throw new Error('所选模型渠道不可用，请在设置中检查凭证；不会自动切换模型');
  const provider = getProvider(primary.providerId);
  const model = primary.modelId?.trim() || settings.providerModels[primary.providerId]?.trim() || provider?.defaultModelId || '';
  const routing = resolveDshProviderRouting({ providerId: primary.providerId, modelId: model, baseUrl: settings.providerBaseUrls[primary.providerId] });
  const apiKey = resolveApiKey(settings, `provider:${primary.providerId}`, settings.providerApiKeys[primary.providerId] || '').trim();
  if (!routing || !model || !apiKey) throw new Error('所选模型缺少 DSH 协议、模型名或凭证，请检查设置');
  const workspace = await homeDir();
  const runId = `text-${crypto.randomUUID()}`;
  const instanceId = crypto.randomUUID();
  const persona = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const input = messages.filter(m => m.role !== 'system').map(m => `[${m.role}]\n${m.content}`).join('\n\n');
  return runDshText((onText, onThinking) => new DshAcpClient({
    runId, apiKey, baseUrl: routing.baseUrl, model, providerId: primary.providerId,
    protocol: routing.protocol, wireModel: routing.wireModelId || undefined,
    sendBearerAuth: routing.sendBearerAuth, workspace,
    persona: `${persona}\n\n只完成本次文本任务，直接输出结果。不得调用工具或执行图片、视频、文件操作。`,
    maxTokens: opts.maxTokens ?? 6000,
    contextWindow: resolveDshContextWindow(provider?.models.find(m => m.id === model)?.contextWindow),
  }, instanceId, ({ update }) => {
    const parsed = parseDshStreamUpdate(update);
    if (parsed.type === 'text') onText(parsed.text);
    if (parsed.type === 'thinking') onThinking();
  }), input, opts);
}
