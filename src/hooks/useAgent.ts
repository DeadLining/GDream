import { savedShotOutcome, safeEvidence } from '@/lib/chat/runPresentation';
import { buildNativeMediaBlocks } from '@/lib/agent/nativeMediaAttachments';
import { useWorkshopStore } from '@/stores/workshopStore';
import { resolveWorkshopExecutionTask } from '@/lib/agent/executionRecovery';
import { useCallback, useRef, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { emit } from '@tauri-apps/api/event';
import {
  GLMClient,
  AgentCoordinator,
  createDefaultRegistry,
  SkillLoader,
  createBackgroundTaskTool,
  createTodoWriteTool,
  executeCommand,
  McpManager,
  MCP_SERVERS,
  repairToolPairingSnapshot,
} from '@/lib/agent';
import { ensureMemoryDirs } from '@/lib/aigc/seedData';
import { appendGenerationLog } from '@/lib/aigc/genLogger';
import { registerHook } from '@/lib/agent/hooks';
import { buildSkillRelevanceNotice } from '@/lib/agent/skillPromptPolicy';
import { recordTrajectory, maybeEvolve } from '@/lib/agent/evolution';
import { registerCleanup } from '@/lib/cleanupRegistry';
import { safeLocalStorage } from '@/lib/safeStorage';
import {
  writeSessionToFile,
  readSessionFromFile,
  writeSessionIndex,
  readAgentMessagesFromLocalStorage,
  readMessagesFromLocalStorage,
  hydrateLocalStorageSession,
  compactAgentMessagesForStorage,
} from '@/lib/historyPersistence';
import type {
  AgentMessage,
  CoordinatorCallbacks,
  ToolExecution,
  TokenUsage,
  AgentUserContentBlock,
} from '@/lib/agent';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey, resolveSlotApiKey, type CredentialHostState } from '@/lib/credentials';
import { useToolConfirmStore } from '@/stores/toolConfirmStore';
import { useBackgroundTaskStore } from '@/stores/backgroundTaskStore';
import { useAigcProjectStore } from '@/stores/aigcProjectStore';
import { useRunStepStore } from '@/stores/runStepStore';
import { useDeepseekHarnessStore } from '@/stores/deepseekHarnessStore';
import { useTodoStore } from '@/stores/todoStore';
import type { AigcProject } from '@/lib/aigc/projectStore';
import type { Message } from '@/types';
import { randomUUID } from '@/lib/uuid';
import {
  ensureActiveConversationSessionRaw,
  ensureSessionTitleRaw,
  useSessions,
  setCoordinatorRestoreCallback,
} from './useSessions';
import { normalizeCustomRules } from '@/lib/agent/rulePolicy';
import { agentLog } from '@/lib/agent/logger';
import { notify } from '@/lib/notify';
import {
  projectUIMessagesToAgentMessages,
  recoverDegradedAgentHistory,
} from '@/lib/agent/projectMessages';
import { stripHarnessPrefix } from '@/lib/agent/harnessDisplay';
import { buildRunFailureNotice, isAbortFailure } from '@/lib/agent/runFailureNotice';
import type { RouteStrategy } from '@/lib/agent/providers/router';
import { decodeChatModel, inferAgentWorkspaceScope } from '@/lib/agent/modelCatalog';
import { isTechnicalProgressText } from '@/lib/agent/toolSummary';
import {
  buildChatRoutePlan,
  buildChatRouteStrategy,
  describeRouteDeviation,
  getPrimaryRouteSelection,
  type ChatRoutePlan,
} from '@/lib/agent/routeStrategy';
import { CoalescedIdleWork } from '@/lib/performance/coalescedIdleWork';
import {
  DshBridge,
  resolveDshContextWindow,
  resolveDshProviderRouting,
} from '@/lib/agent/dsh';
import { getProvider } from '@/lib/agent/providers/registry';

async function invokeWithStartupTimeout<T>(
  command: string,
  args: Record<string, unknown>,
  timeoutMs = 3_000,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke<T>(command, args),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${command} 启动读取超时（${timeoutMs}ms）`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function hasAnyChatProviderKey(
  settings: CredentialHostState & { glmApiKey?: string },
): boolean {
  if (resolveApiKey(settings, 'glm', settings.glmApiKey ?? '').trim()) return true;
  const ids = new Set<string>([
    ...Object.keys(settings.providerApiKeys ?? {}),
    ...Object.keys(settings.credentialRefs ?? {})
      .filter((cap) => cap.startsWith('provider:'))
      .map((cap) => cap.slice('provider:'.length)),
  ]);
  for (const id of ids) {
    if (resolveApiKey(settings, `provider:${id}`, settings.providerApiKeys?.[id] ?? '').trim()) return true;
  }
  return false;
}

function buildRouteStrategyFromSettings(
  settings: ReturnType<typeof useSettingsStore.getState>,
  legacyGlmApiKey?: string,
  preferredProviderId?: string,
  pinned?: { providerId: string; modelId: string } | null,
): RouteStrategy | undefined {
  return buildChatRouteStrategy(settings, {
    legacyGlmApiKey,
    primary: pinned,
    legacyAgentPreference: preferredProviderId,
  });
}

/** Same route, but with the diagnostics needed to explain a degraded outcome. */
function buildRoutePlanFromSettings(
  settings: ReturnType<typeof useSettingsStore.getState>,
  legacyGlmApiKey?: string,
  preferredProviderId?: string,
  pinned?: { providerId: string; modelId: string } | null,
): ChatRoutePlan {
  return buildChatRoutePlan(settings, {
    legacyGlmApiKey,
    primary: pinned,
    legacyAgentPreference: preferredProviderId,
  });
}

type SettingsSnapshot = ReturnType<typeof useSettingsStore.getState>;

function buildComposerModelRules(settings: SettingsSnapshot): string {
  return `## 普通对话生成模型偏好
- 生图默认模型：${settings.chatImageModel || 'gpt-image-2'}
- 生视频默认模型：${settings.chatVideoModel || 'seedance-2.0'}
当用户在普通对话中要求生视频时，直接调用 video_generate；用户指定 MiniMax/H3/海螺 H3 时 engine=minimax-h3。不要切换到画布，不要创建画布节点，除非用户明确说“放到画布”或要求操作某个画布节点。普通 MG 动画使用 mg_generate_with_reference_boards，也不要求进入画布。
当用户没有明确指定模型时，必须使用上述选择。用户明确指定、当前模型不支持任务，或路由失败时才改用其他模型，并说明原因。此偏好不覆盖画布节点、工坊镜头或剪辑时间线里已经保存的模型选择。`;
}

function buildAgentCustomRules(
  baseRules: string | undefined,
  settings: SettingsSnapshot,
  agentId: string,
): string | undefined {
  const meta = settings.agentMetas[agentId];
  return [
    baseRules,
    buildComposerModelRules(settings),
    meta?.systemPromptAddition
      ? `## Agent 专属规则 (${meta.name ?? agentId})\n${meta.systemPromptAddition}`
      : undefined,
  ].filter(Boolean).join('\n\n') || undefined;
}

function historyText(content: AgentMessage['content']): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .map((block) => block.type === 'text' ? block.text : `[${block.type}附件]`)
    .join('\n');
}

/** Rehydrate an ACP session from the coordinator's persisted conversation. */
function buildDshConversationContext(messages: AgentMessage[], maxChars = 160_000): string {
  const turns = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${historyText(message.content)}`);
  const selected: string[] = [];
  let used = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (selected.length > 0 && used + turn.length > maxChars) break;
    selected.unshift(turn);
    used += turn.length;
  }
  return selected.length > 0
    ? `[当前任务的既有对话记录，仅作为上下文继续处理]\n${selected.join('\n\n')}`
    : '';
}


// ── AgentMessage 持久化 ─────────────────────────────────────────────────────
const AGENT_MSGS_PREFIX = 'gdream-agent-messages-';
function compactToolExecutionsForHistory(executions: ToolExecution[]): ToolExecution[] {
  return executions.map((execution) => {
    const output = safeEvidence(execution.result?.output ?? '') as string;
    const error = safeEvidence(execution.result?.error) as string | undefined;
    return {
      ...execution,
      params: {},
      result: execution.result
        ? {
            ...execution.result,
            output: output.length > 4_000
              ? `${output.slice(0, 3_200)}\n\n[结果已压缩，原始长度 ${output.length.toLocaleString()} 字符]`
              : output,
            ...(error ? { error: error.slice(0, 4_000) } : {}),
          }
        : undefined,
    };
  });
}

interface AgentMessagesSaveSnapshot {
  sessionId: string;
  messages: AgentMessage[];
}

async function persistAgentMessagesNow({ sessionId, messages }: AgentMessagesSaveSnapshot): Promise<void> {
  const compactMessages = compactAgentMessagesForStorage(messages);
  try {
    safeLocalStorage.setItem(AGENT_MSGS_PREFIX + sessionId, JSON.stringify(compactMessages));
  } catch { /* quota */ }
  const uiMessages = readMessagesFromLocalStorage(sessionId) ?? [];
  // localStorage is only a small fast cache. The per-session file receives
  // the richer history and applies its own much larger disk safety limit.
  await writeSessionToFile(sessionId, { messages: uiMessages, agentMessages: messages });
}

const agentMessagesSaveQueue = new CoalescedIdleWork<AgentMessagesSaveSnapshot>(
  persistAgentMessagesNow,
  { debounceMs: 1_500, minIntervalMs: 15_000 },
);

function saveAgentMessages(sessionId: string, messages: AgentMessage[]) {
  // getMessages returns a snapshot array today; copy it defensively so later
  // coordinator appends cannot change the queued persistence boundary.
  agentMessagesSaveQueue.schedule(sessionId, { sessionId, messages: [...messages] });
}

function flushAgentMessages(sessionId: string, messages: AgentMessage[]): Promise<void> {
  return agentMessagesSaveQueue.flush(sessionId, { sessionId, messages: [...messages] });
}

function loadAgentMessages(sessionId: string): AgentMessage[] | null {
  return readAgentMessagesFromLocalStorage(sessionId);
}

function deleteAgentMessages(sessionId: string) {
  try {
    localStorage.removeItem(AGENT_MSGS_PREFIX + sessionId);
  } catch { /* ignore */ }
}

/** 从设置中构建生图 API 上下文文本，注入 system prompt */
function buildImageApiContext(settings: ReturnType<typeof useSettingsStore.getState>): string | undefined {
  const slots = settings.imageApiSlots?.filter(s => s.enabled && s.baseUrl && resolveSlotApiKey(settings, s));
  if (!slots || slots.length === 0) return undefined;

  const latency = settings.imageApiLatency || {};
  const ONE_HOUR = 60 * 60 * 1000;

  // 按测速缓存排序（未过期的按延迟升序，过期/无缓存的按 priority）
  const sorted = [...slots].sort((a, b) => {
    const la = latency[a.id];
    const lb = latency[b.id];
    const aFresh = la && la.latencyMs >= 0 && (Date.now() - la.testedAt) < ONE_HOUR;
    const bFresh = lb && lb.latencyMs >= 0 && (Date.now() - lb.testedAt) < ONE_HOUR;
    if (aFresh && bFresh) return la.latencyMs - lb.latencyMs;
    if (aFresh) return -1;
    if (bFresh) return 1;
    return a.priority - b.priority;
  });

  const lines = sorted.map((s, i) => {
    const lat = latency[s.id];
    const latStr = lat && lat.latencyMs >= 0 ? ` (${lat.latencyMs}ms)` : '';
    return `${i + 1}. ${s.label}: provider=${s.provider || 'dmxapi'}${latStr}`;
  });

  return `普通对话生图必须优先调用 image_generate 工具，禁止自己拼 API 请求或临时编写生图脚本。该工具会读取底部当前选择的 GPT Image 2 / 豆包 5 Pro，并自动完成多 API 降级、参考图压缩、比例到像素尺寸的转换和图片回传。

  比例纪律：调用 image_generate 时必须传 aspect_ratio。用户明确说横版/竖版/方图或 16:9、9:16、1:1 等比例时严格照传；用户未指定才默认 16:9。禁止只把比例写进 prompt 而遗漏工具参数。

  当前配置的生图 API（按速度排序）：

  ${lines.join('\n')}

  只有 image_generate 不可用或维护旧任务时，才允许降级使用 ~/.gdream/skills/image-generation/image_client.py。旧客户端调用也必须显式传 aspect_ratio：
\`\`\`python
import sys, os, json
sys.path.insert(0, os.path.expanduser('~/.gdream/skills/image-generation'))
from image_client import ImageGenerationClient
# 槽位配置（含 key）由GDream写入此文件，不要把 key 打印到输出
slots = json.load(open(os.path.expanduser('~/.gdream/image_api_slots.json')))
client = ImageGenerationClient(api_slots=slots)
result = client.generate(prompt='描述', output_path='/path/to/output.png', model='gpt-image-2', aspect_ratio='16:9', resolution='2k')
result_pro = client.generate(prompt='描述', output_path='/path/to/seedream.png', model='seedream-v5-pro', aspect_ratio='16:9', resolution='2k')
print(json.dumps({"success": result.success, "path": result.image_path, "model": result.model_used}, ensure_ascii=False))
\`\`\`

  旧客户端图生图示例（带参考图）：
\`\`\`python
import base64
ref_b64 = base64.b64encode(open('参考图.png', 'rb').read()).decode()
result = client.generate(
    prompt='描述',
    output_path='/path/to/output.png',
    model='gpt-image-2',  # 也可用 seedream-v5-pro；带图时务必传 reference_images，避免退化成文生图
    aspect_ratio='16:9',
    reference_images=[("ref", ref_b64)],  # 客户端会自动压缩到 1536px
)
\`\`\`

支持模型：gpt-image-2（主力）、seedream-v5-pro（Seedream 5.0 Pro，DMXAPI / 即梦 CLI / RunningHub 智能路由；适合审美要求高的资产图/分镜图）。即梦 CLI 未登录时，系统会自动发起 Agent 登录恢复，不要把登录错误误判成提示词失败。
参考图会自动压缩到 1536px/85quality，避免几十兆原图拖慢上传，同时保留人物/场景参考细节。`;
}

/**
 * 把生图槽位（含 key）写到 ~/.gdream/image_api_slots.json，供 image_client.py
 * 读取。这样 key 不进入 system prompt / 对话历史（修复 key 泄漏问题）。
 */
async function syncImageSlotsFile(settings: ReturnType<typeof useSettingsStore.getState>): Promise<void> {
  const slots = settings.imageApiSlots?.filter(s => s.enabled && s.baseUrl && resolveSlotApiKey(settings, s)) ?? [];
  const payload = slots.map(s => ({
    label: s.label,
    base_url: s.baseUrl,
    api_key: resolveSlotApiKey(settings, s),
    provider: s.provider || 'dmxapi',
  }));
  try {
    // Owner-only (0600) write: this file carries per-channel API keys.
    await invoke('write_text_file_private', {
      path: '.gdream/image_api_slots.json',
      contents: JSON.stringify(payload, null, 2),
    });
  } catch (err) {
    agentLog.warn('Agent', 'Failed to sync image slots file', err);
  }
}

function buildRunninghubContext(settings: ReturnType<typeof useSettingsStore.getState>): string | undefined {
  const key = resolveApiKey(settings, 'runninghub', settings.runninghubApiKey);
  if (key) {
    // key 本体不进提示词（避免进入持久化的对话历史），脚本自动从
    // ~/.gdream/gdream.json 或环境变量读取（见 syncRunninghubKeyFile）。
    return `RunningHub API Key 已配置（脚本会自动从 ~/.gdream/gdream.json 读取，不需要传 --api-key）：
\`\`\`bash
python3 ~/.gdream/skills/rhtv/scripts/runninghub.py --endpoint ... --prompt "..." -o /tmp/gdream/rh-output/...
\`\`\`
普通对话直接生视频优先调用 video_generate；它会读取底部选择的默认视频模型，直接保存并交付结果，不需要切换画布。MiniMax H3 也由 video_generate 直接调用。
仅在 video_generate 不覆盖的长尾模型上使用脚本。Seedance 视频脚本兜底必须用 kuaizi.py，不要用 runninghub.py：
\`\`\`bash
python3 ~/.gdream/skills/rhtv/scripts/kuaizi.py --prompt "..." --mode pro --image ref.png -o /tmp/gdream/rh-output/seedance_$(date +%s).mp4
\`\`\`
画布场景用 canvas_generate 工具（后端自动走丽帧）。用户没有要求进入画布时，禁止为了生视频自行切换到画布或创建节点。
⚠️ 下载生成结果时禁止自行 curl/wget——脚本内置 COS 云函数中转加速，直连极慢。如需单独下载远程文件：
\`\`\`bash
python3 ~/.gdream/skills/rhtv/scripts/runninghub.py --download-url "URL" -o /tmp/gdream/rh-output/name.ext
\`\`\``;
  }
  // 即使设置中没有填 key，也注入上下文：脚本会自动从环境变量 RUNNINGHUB_API_KEY 获取
  return `RunningHub 可用。API Key 未在GDream设置中配置，但 runninghub.py 会自动从环境变量 RUNNINGHUB_API_KEY 或 ~/.gdream/gdream.json 获取。
执行时不需要传 --api-key 参数，脚本会自动读取：
\`\`\`bash
python3 ~/.gdream/skills/rhtv/scripts/runninghub.py --endpoint ... --prompt "..." -o /tmp/gdream/rh-output/...
\`\`\`
如果执行失败提示 key 未配置，请在GDream设置中填写 RunningHub API Key，或在 ~/.zshrc 中设置 export RUNNINGHUB_API_KEY=xxx。`;
}

/**
 * 把 RunningHub key 同步到 ~/.gdream/gdream.json（runninghub.py 的标准读取
 * 位置），替代把 key 拼进 system prompt 的旧做法。
 */
async function syncRunninghubKeyFile(settings: ReturnType<typeof useSettingsStore.getState>): Promise<void> {
  const key = resolveApiKey(settings, 'runninghub', settings.runninghubApiKey).trim();
  if (!key) return;
  try {
    const { readTextFile: rtf, exists: ex, BaseDirectory: BD } = await import('@tauri-apps/api/fs');
    const path = '.gdream/gdream.json';
    let cfg: Record<string, any> = {};
    if (await ex(path, { dir: BD.Home })) {
      try { cfg = JSON.parse(await rtf(path, { dir: BD.Home })); } catch { cfg = {}; }
    }
    const entries = ((cfg.skills ??= {}).entries ??= {});
    let changed = false;
    if (entries.runninghub?.apiKey !== key) {
      (entries.runninghub ??= {}).apiKey = key;
      changed = true;
    }
    const transit = settings.cosTransitEndpoint?.trim() || '';
    if (transit && entries.runninghub?.cosTransitEndpoint !== transit) {
      (entries.runninghub ??= {}).cosTransitEndpoint = transit;
      changed = true;
    }
    if (!changed) return;
    // Owner-only (0600) write: this file carries the RunningHub key.
    await invoke('write_text_file_private', { path, contents: JSON.stringify(cfg, null, 2) });
  } catch (err) {
    agentLog.warn('Agent', 'Failed to sync runninghub key file', err);
  }
}

/** 从当前 AIGC 项目构建上下文文本（注入 system prompt 的 aigcMemoryContext 槽位） */
function buildAigcProjectContext(project: AigcProject | null): string | undefined {
  if (!project) return undefined;

  const STATUS_LABEL: Record<AigcProject['status'], string> = {
    'draft': '草稿（待上传文档）',
    'parsed': '文档已解析',
    'prompts-ready': '提示词已生成',
    'scenes-ready': '场景图已生成',
    'assets-ready': '资产图已就绪',
    'video-generating': '正在生成视频',
    'completed': '已完成',
  };

  const lines: string[] = [];
  lines.push(`[当前 AIGC 项目]`);
  lines.push(`- 名称: ${project.name}`);
  lines.push(`- slug: ${project.slug}`);
  lines.push(`- 阶段: ${STATUS_LABEL[project.status]}`);
  lines.push(`- 项目目录: ~/.gdream/aigc-memory/projects/${project.id}/`);
  lines.push(`- 视频引擎: ${project.videoEngine === 'dreamina' ? '即梦（非真人） — dreamina multimodal2video' : 'rhtv (RunningHub seedance2.0)'}`);

  if (project.sources.length > 0) {
    const names = project.sources.map((s) => s.name.split('/').pop() || s.name).join(', ');
    lines.push(`- 已上传文档: ${names}`);
  } else {
    lines.push(`- 已上传文档: （无）`);
  }

  const { shots, scenes, assets, videosCompleted } = project.stats;
  lines.push(`- 进度: 分镜 ${shots} · 场景图 ${scenes} · 资产图 ${assets} · 视频已完成 ${videosCompleted}`);

  lines.push('');
  lines.push('当用户在对话中提到"当前项目""这个项目""继续做镜头 N"等指代时，默认指向上述项目；');
  lines.push('读取/写入项目数据请使用 `~/.gdream/aigc-memory/projects/<id>/` 下对应子目录（sources/parsed/prompts/scenes/assets）。');

  return lines.join('\n');
}

// DeepSeek Harness runs outlive individual view components. Canvas/workshop/
// editor drawers are remounted while the shared chat store keeps streaming,
// so cancellation cannot be owned only by one hook instance's refs.
const sharedDshBridges = new Map<string, DshBridge>();

function registerSharedDshBridge(agentId: string, bridge: DshBridge): void {
  sharedDshBridges.set(agentId, bridge);
}

function unregisterSharedDshBridge(agentId: string, bridge: DshBridge): void {
  if (sharedDshBridges.get(agentId) === bridge) sharedDshBridges.delete(agentId);
}

function getSharedDshBridge(agentId: string): DshBridge | null {
  const exact = sharedDshBridges.get(agentId);
  if (exact) return exact;
  // A remounted drawer can temporarily lose its local Agent identity while
  // the shared chat store still owns one active stream. Falling back is safe
  // only when there is exactly one candidate; never stop an arbitrary run.
  return sharedDshBridges.size === 1
    ? sharedDshBridges.values().next().value ?? null
    : null;
}

/**
 * useAgent — Agent 生命周期管理 Hook
 * 替代原有的 useGateway + useSessions 中的消息发送逻辑
 */
export function useAgent(options?: { primary?: boolean }) {
  // Secondary instances (skill wizard) get their own coordinators but must
  // NOT own session-level duties: restoring the chat session into their
  // coordinator, registering the global restore callback (would hijack the
  // primary instance's session switching), or persisting their short
  // wizard-scoped history into the real session file.
  const isPrimary = options?.primary !== false;
  const glmClientRef = useRef<GLMClient | null>(null);
  const coordinatorRef = useRef<AgentCoordinator | null>(null);
  // Tier 4: per-agent coordinators. Each agent gets its own coordinator so
  // two agents can run concurrent streams. `coordinatorRef` tracks the active
  // one (most recently used or the one matching the current agent) so legacy
  // call sites (e.g. abort/switchCwd) keep working.
  const coordinatorsRef = useRef<Map<string, AgentCoordinator>>(new Map());
  const dshBridgesRef = useRef<Map<string, DshBridge>>(new Map());
  const activeRunIdsRef = useRef<Map<string, string>>(new Map());
  /** Session locked by the currently in-flight UI run (serialized by
   * sendingRef, so at most one). Read by session-scoped tool getters. */
  const activeRunSessionRef = useRef<string | null>(null);
  /** Coordinators/bridges whose teardown was deferred because a settings
   * change (e.g. clearing every provider key) fired the engine effect's
   * cleanup while they were mid-run. Drained once their runs finish. */
  const deferredTeardownRef = useRef<Array<{ getIsRunning: () => boolean; abort: () => unknown }>>([]);
  const drainDeferredTeardown = () => {
    const pending = deferredTeardownRef.current;
    if (!pending.length) return;
    deferredTeardownRef.current = pending.filter((entry) => {
      if (entry.getIsRunning()) return true;
      try {
        entry.abort();
      } catch {
        /* best effort */
      }
      return false;
    });
  };
  const coordinatorFactoryRef = useRef<((agentId: string) => AgentCoordinator) | null>(null);
  const baseCustomRulesRef = useRef<string | undefined>(undefined);
  const skillLoaderRef = useRef<SkillLoader | null>(null);
  const mcpManagerRef = useRef<McpManager | null>(null);
  const toolExecutionsRef = useRef<ToolExecution[]>([]);
  const userAbortedRef = useRef(false); // guards against double-cleanup after user abort
  const activeRunTokenRef = useRef(0);
  const lastUiSendRef = useRef<{ content: string; at: number } | null>(null);
  // Serializes session restores: a slow restore (LLM compact inside
  // restoreMessages) must not overwrite a newer one.
  const restoreSeqRef = useRef(0);
  // Closes the sendMessage startup window: between the isRunning check and
  // DSH 启动 there are awaits (session ensure, native media loading)
  // during which a second send would start a competing run on the same
  // coordinator and silently drop the first message.
  const sendingRef = useRef(false);
  const [isReady, setIsReady] = useState(false);

  // Hermes-style self-evolution: every finished run appends a compact
  // trajectory record, then maybe fires a background reflection pass.
  // Best-effort — never blocks or breaks the foreground run.
  const recordRunTrajectory = useCallback(
    (status: 'done' | 'failed' | 'aborted', req: string, startTime: number | null) => {
      try {
        const tools: Record<string, number> = {};
        const fail: Record<string, number> = {};
        for (const te of toolExecutionsRef.current) {
          tools[te.toolName] = (tools[te.toolName] || 0) + 1;
          if (te.status === 'error') fail[te.toolName] = (fail[te.toolName] || 0) + 1;
        }
        void recordTrajectory({
          ts: Date.now(),
          req: req.slice(0, 160),
          tools,
          fail,
          secs: startTime ? Math.max(0, Math.floor((Date.now() - startTime) / 1000)) : 0,
          status,
        })
          .then(() => maybeEvolve())
          .catch(() => {});
      } catch { /* evolution is best-effort */ }
    },
    [],
  );

  const { persistMessages } = useSessions();

  const addMessage = useChatStore((s) => s.addMessage);
  const setIsStreaming = useChatStore((s) => s.setIsStreaming);
  const clearStreamingContent = useChatStore((s) => s.clearStreamingContent);
  const setStreamingPhase = useChatStore((s) => s.setStreamingPhase);
  const setStreamingSessionId = useChatStore((s) => s.setStreamingSessionId);
  const setSessionStreaming = useChatStore((s) => s.setSessionStreaming);
  const startStreaming = useChatStore((s) => s.startStreaming);
  const setError = useChatStore((s) => s.setError);

  const glmApiKey = useSettingsStore((s) => resolveApiKey(s, 'glm', s.glmApiKey));
  const providerGlmApiKey = useSettingsStore((s) => resolveApiKey(s, 'provider:glm', s.providerApiKeys?.glm ?? ''));
  const credentials = useSettingsStore((s) => s.credentials);
  const credentialRefs = useSettingsStore((s) => s.credentialRefs);
  const glmBaseUrl = useSettingsStore((s) => s.glmBaseUrl);
  const glmModel = useSettingsStore((s) => s.glmModel);
  const defaultCwd = useSettingsStore((s) => s.defaultCwd);
  const providerApiKeys = useSettingsStore((s) => s.providerApiKeys);
  const imageSlotsSig = useSettingsStore((s) =>
    JSON.stringify([
      (s.imageApiSlots ?? []).map(x => [x.label, x.baseUrl, x.apiKey, x.credentialId, x.provider, x.enabled]),
      s.credentials,
    ]),
  );
  const runninghubApiKey = useSettingsStore((s) => resolveApiKey(s, 'runninghub', s.runninghubApiKey));
  const chatImageModel = useSettingsStore((s) => s.chatImageModel);
  const chatVideoModel = useSettingsStore((s) => s.chatVideoModel);
  const hasConfiguredChatProvider = hasAnyChatProviderKey({ glmApiKey, providerApiKeys, credentials, credentialRefs });

  // Initialize agent engine
  useEffect(() => {
    if (!hasConfiguredChatProvider) {
      setIsReady(false);
      return;
    }

    let cancelled = false;
    let unregisterGenHook: (() => void) | null = null;
    let unregisterCleanup: (() => void) | null = null;

    const initializeAgentEngine = async () => {
      const markStage = (stage: string) => agentLog.info('AgentInit', stage);
      markStage('开始初始化 Agent 引擎');
      // Get home dir from Tauri backend (process.env.HOME is not available in WebView)
      let homeDir = '~';
      try {
        homeDir = await invoke<string>('get_home_dir');
      } catch {
        agentLog.warn('Agent', 'Failed to get home dir from Tauri');
      }

      if (cancelled) return;

      // Sync API keys to disk files read by skill scripts (keys must NOT be
      // embedded into system prompts — they'd persist into chat history).
      markStage('正在同步本地模型配置');
      {
        const settingsSnapshot = useSettingsStore.getState();
        await Promise.all([
          syncImageSlotsFile(settingsSnapshot),
          syncRunninghubKeyFile(settingsSnapshot),
        ]);
      }
      markStage('本地模型配置同步完成');

      // Load skills first so we can inject descriptions into system prompt
      markStage('正在加载技能库');
      const loader = new SkillLoader([
        `${homeDir}/.gdream/skills`,
        `${homeDir}/gdream/skills`,
      ]);
      skillLoaderRef.current = loader;
      await loader.loadAll();
      agentLog.info('Agent', `Loaded ${loader.getAll().length} skills`);
      markStage('技能库加载完成');

      // Memory seeding is maintenance work, not a readiness dependency. Large
      // existing memory libraries can take seconds to inspect on slower disks;
      // keeping this off the critical path prevents the whole Agent UI from
      // appearing disconnected while those files are checked.
      markStage('正在后台维护项目记忆');
      setTimeout(() => {
        void ensureMemoryDirs()
          .then(() => agentLog.info('AgentInit', '项目记忆后台维护完成'))
          .catch((err) => agentLog.warn('AgentInit', `项目记忆后台维护失败：${String(err)}`));
      }, 15_000);

      // Register post-generation logging hook
      unregisterGenHook = registerHook('postToolUse', async (ev) => {
        if (ev.toolName === 'canvas_add_node') {
          const data = ev.params?.data as Record<string, unknown> | undefined;
          if (data?.generatedImageUrl || data?.generatedVideoUrl) {
            await appendGenerationLog({
              timestamp: new Date().toISOString(),
              director: '',
              taskType: data.type === 'image' ? 'text-to-image' : 'text-to-video',
              engine: 'other',
              prompt: '',
              outputPath: String(data.generatedImageUrl || data.generatedVideoUrl || ''),
            }).catch(() => {});
          }
        }
      });

      if (cancelled) return;

      // Create GLM client
      const client = new GLMClient({
        apiKey: glmApiKey || providerGlmApiKey || '__gdream_no_glm_key__',
        baseUrl: glmBaseUrl || 'https://open.bigmodel.cn/api/anthropic',
        model: glmModel || 'glm-5.1',
      });
      glmClientRef.current = client;

      // Create tool registry (built-in tools only — MCP loads later)
      const registry = createDefaultRegistry();

      // Register background task tool (for async dreamina polling).
      // Session getters prefer the session locked by the in-flight run:
      // a view/session switch mid-run must not redirect tool writes (todos,
      // background tasks) into the newly opened session.
      registry.register(createBackgroundTaskTool(
        () => activeRunSessionRef.current || useChatStore.getState().currentSessionId || '',
        (task) => useBackgroundTaskStore.getState().addTask(task),
      ));

      // Tier 3: todo list tool (needs session id)
      registry.register(createTodoWriteTool(
        () => activeRunSessionRef.current || useChatStore.getState().currentSessionId || '',
      ));

      // Ensure workspace exists and get today's workspace path
      let workspace = '';
      markStage('正在准备工作区');
      try {
        workspace = await invoke<string>('ensure_workspace');
        agentLog.info('Agent', `Workspace: ${workspace}`);
      } catch {
        agentLog.warn('Agent', 'Failed to create workspace');
      }
      markStage('工作区准备完成');

      // Load layered memory: global (~/.gdream/) + project ({cwd}/.gdream/)
      const ruleParts: string[] = [];

      // 1. Global rules: ~/.gdream/AGENT.md or ~/.gdream/CLAUDE.md
      markStage('正在读取全局 Agent 规则');
      try {
        for (const filename of ['AGENT.md', 'CLAUDE.md']) {
          const path = `${homeDir}/.gdream/${filename}`;
          try {
            const result = await invokeWithStartupTimeout<{ content: string }>('read_file', { path });
            const content = result.content.replace(/^\s*\d+\t/gm, '');
            if (content.trim()) {
              ruleParts.push(content);
              agentLog.info('Agent', `Loaded global rules from ${path} (${content.length} chars)`);
              break; // Use first found
            }
          } catch {
            // File doesn't exist, try the next supported global rule name.
          }
        }
      } catch {
        agentLog.warn('Agent', 'Failed to load global rules');
      }
      markStage('全局 Agent 规则读取完成');

      // 2. Project-level rules: {cwd}/.gdream/CLAUDE.md
      const cwd = workspace || defaultCwd || homeDir;
      markStage('正在读取项目 Agent 规则');
      try {
        const projectPaths = [
          `${cwd}/.gdream/CLAUDE.md`,
          `${cwd}/.gdream/AGENT.md`,
          `${cwd}/CLAUDE.md`,
        ];
        for (const projectPath of projectPaths) {
          try {
            const content = await invokeWithStartupTimeout<{ content: string }>(
              'read_file',
              { path: projectPath },
            );
            if (content?.content?.trim()) {
              // Strip line numbers (read_file returns cat -n format)
              const raw = content.content.replace(/^\s*\d+\t/gm, '');
              ruleParts.push(`\n## 项目规则 (${projectPath})\n${raw}`);
              agentLog.info('Agent', `Loaded project rules from ${projectPath}`);
              break;
            }
          } catch {
            // File doesn't exist, try next
          }
        }
      } catch {
        agentLog.warn('Agent', 'Failed to load project rules');
      }
      markStage('项目 Agent 规则读取完成');

      const normalizedRules = normalizeCustomRules(ruleParts.join('\n\n'));
      if (normalizedRules.notices.length > 0) {
        agentLog.warn('Agent', `Custom rule compatibility: ${normalizedRules.notices.join(' ')}`);
      }
      const customRules = [
        normalizedRules.notices.length > 0
          ? `## 自定义规则兼容说明\n${normalizedRules.notices.map((notice) => `- ${notice}`).join('\n')}`
          : '',
        normalizedRules.rules,
      ].filter(Boolean).join('\n\n') || undefined;
      baseCustomRulesRef.current = customRules;

      // Factory — lazily builds a coordinator for a given agent id.
      // Closes over the shared client/registry/workspace/customRules so
      // additional agents are cheap to spin up (no duplicated skill load).
      const buildCoordinator = (agentId: string): AgentCoordinator => {
        const settings = useSettingsStore.getState();
        const meta = settings.agentMetas[agentId];
        const globalOutputStyle = settings.outputStyle;
        const mergedRules = buildAgentCustomRules(customRules, settings, agentId);

        const coordinatorConfig = {
          glmClient: client,
          toolRegistry: registry,
          cwd,
          os: 'macOS',
          shell: 'zsh',
          workspace: workspace || undefined,
          skillDescriptions: loader.getDescriptionText({
            activeView: useChatStore.getState().activeView,
          }) || undefined,
          skillDescriptionResolver: (query: string) => loader.getDescriptionText({
            activeView: useChatStore.getState().activeView,
            query,
          }) || undefined,
          // Query-dependent relevance goes to a transient attachment, not the
          // system prompt — keeps the cached prefix byte-stable across turns.
          skillNoticeResolver: (query: string) =>
            buildSkillRelevanceNotice(loader.getAll(), {
              activeView: useChatStore.getState().activeView,
              query,
            }),
          customRules: mergedRules,
          routeStrategy: buildRouteStrategyFromSettings(settings, glmApiKey, meta?.preferredProviderId),
          outputStyle: meta?.outputStyle ?? globalOutputStyle ?? 'default',
          imageApiContext: buildImageApiContext(settings),
          runninghubContext: buildRunninghubContext(settings),
          aigcMemoryContext: buildAigcProjectContext(useAigcProjectStore.getState().getCurrent()),
        };

        const c = new AgentCoordinator(coordinatorConfig);

        return c;
      };

      coordinatorFactoryRef.current = buildCoordinator;

      // Create the default 'main' coordinator eagerly so existing single-agent
      // flows keep working unchanged.
      const defaultAgentId = 'main';
      const defaultCoordinator = buildCoordinator(defaultAgentId);
      coordinatorsRef.current.set(defaultAgentId, defaultCoordinator);
      coordinatorRef.current = defaultCoordinator;

      // Register cleanup for window close: persist all coordinator state
      unregisterCleanup = registerCleanup(() => {
        const state = useChatStore.getState();
        const sid = state.currentSessionId;
        if (!sid) return;
        // Persist UI messages from Zustand to localStorage
        if (state.messages.length > 0) {
          try { safeLocalStorage.setItem('gdream-messages-' + sid, JSON.stringify(state.messages)); } catch { /* quota */ }
        }
        // Persist coordinator messages
        for (const [agentId, c] of coordinatorsRef.current.entries()) {
          const msgs = compactAgentMessagesForStorage(c.getMessages());
          if (msgs.length <= 1) continue;
          const parts = sid.split(':');
          const sAgentId = parts.length >= 3 ? parts[1] : 'main';
          if (sAgentId === agentId) {
            try { safeLocalStorage.setItem('gdream-agent-messages-' + sid, JSON.stringify(msgs)); } catch { /* quota */ }
          }
        }
        // Update session timestamp
        try {
          const updated = state.sessions.map(s =>
            s.id === sid ? { ...s, updatedAt: Date.now() } : s
          );
          safeLocalStorage.setItem('gdream-sessions', JSON.stringify(updated));
          void writeSessionIndex(updated);
        } catch { /* quota */ }
        // Mirror to per-session file (file is the source of truth on reload).
        try {
          const activeAgentId = (sid.split(':').length >= 3 ? sid.split(':')[1] : 'main');
          const activeCoord = coordinatorsRef.current.get(activeAgentId);
          const agentMessages = activeCoord ? activeCoord.getMessages() : [];
          void flushAgentMessages(sid, agentMessages);
        } catch { /* ignore */ }
      });

      // Restore AgentMessage[] from the current active session (if any).
      // Primary instance only — a secondary (wizard) engine restoring the
      // chat session into its own coordinator is wasted work and double IO.
      const currentSessionId = useChatStore.getState().currentSessionId;
      if (isPrimary && currentSessionId) {
        markStage('正在恢复当前会话');
        let saved = loadAgentMessages(currentSessionId);
        if (saved === null) {
          const fromFile = await readSessionFromFile(currentSessionId);
          if (fromFile) {
            hydrateLocalStorageSession(currentSessionId, fromFile);
            saved = fromFile.agentMessages;
          } else {
            saved = [];
          }
        }
        if (saved.length > 0) {
          let uiMsgs = readMessagesFromLocalStorage(currentSessionId);
          if (uiMsgs === null) {
            const fromFile = await readSessionFromFile(currentSessionId);
            uiMsgs = fromFile?.messages ?? [];
          }
          const recovered = recoverDegradedAgentHistory(saved, uiMsgs);
          await defaultCoordinator.restoreMessages(recovered);
          if (recovered !== saved) {
            saveAgentMessages(currentSessionId, recovered);
            agentLog.warn('Agent', `Rebuilt degraded compacted history from ${uiMsgs.length} visible messages for ${currentSessionId}`);
          } else {
            agentLog.info('Agent', `Restored ${saved.length} agent messages for session ${currentSessionId}`);
          }
        } else {
          // Fallback: rebuild from UI messages if agent-messages was lost
          let uiMsgs = readMessagesFromLocalStorage(currentSessionId);
          if (uiMsgs === null) {
            const fromFile = await readSessionFromFile(currentSessionId);
            uiMsgs = fromFile?.messages ?? [];
          }
          if (uiMsgs.length > 0) {
            const projected = projectUIMessagesToAgentMessages(uiMsgs);
            if (projected.length > 0) {
              await defaultCoordinator.restoreMessages(projected);
              agentLog.warn('Agent', `Rebuilt ${projected.length} agent msgs from UI for session ${currentSessionId}`);
            }
          }
        }
        markStage('当前会话恢复完成');
      }

      // Ready immediately with built-in tools — no waiting for MCP
      setIsReady(true);
      agentLog.info('Agent', 'Engine initialized (built-in tools)');

      // Non-blocking: load MCP tools in background
      // MCP endpoints may be local/network services with no model-provider
      // credential. Do not gate their discovery on a GLM key; HttpTransport
      // omits Authorization when the config says auth: 'none'.
      if (MCP_SERVERS.length > 0) {
        const mcpManager = new McpManager(MCP_SERVERS);
        mcpManagerRef.current = mcpManager;
        mcpManager.initialize(glmApiKey || providerGlmApiKey || '').then(({ tools: mcpTools, errors: mcpErrors }) => {
          if (cancelled) { mcpManager.shutdown(); return; }
          for (const tool of mcpTools) {
            registry.register(tool);
          }
          // Refresh system prompt so ALL coordinators pick up new MCP tools
          for (const c of coordinatorsRef.current.values()) {
            c.refreshSystemPrompt();
          }
          agentLog.info('Agent', `MCP: ${mcpTools.length} tools loaded${mcpErrors.length > 0 ? `, ${mcpErrors.length} errors` : ''}`);
        }).catch((err) => {
          agentLog.error('Agent', 'MCP initialization failed', err);
        });
      }
    };

    void initializeAgentEngine().catch((error) => {
      if (cancelled) return;
      const reason = error instanceof Error ? error.message : String(error);
      agentLog.error('AgentInit', `Agent 引擎初始化失败: ${reason}`, error);
      setIsReady(false);
      setError(`Agent 初始化失败：${reason}`);
    });

    return () => {
      cancelled = true;
      unregisterGenHook?.();
      unregisterCleanup?.();
      // Persist coordinator state to localStorage before abort
      const cleanupState = useChatStore.getState();
      const cleanupSid = cleanupState.currentSessionId;
      if (cleanupSid) {
        const cleanupCoordinator = coordinatorRef.current;
        if (cleanupCoordinator) {
          const msgs = compactAgentMessagesForStorage(cleanupCoordinator.getMessages());
          if (msgs.length > 1) {
            try { safeLocalStorage.setItem(AGENT_MSGS_PREFIX + cleanupSid, JSON.stringify(msgs)); } catch { /* quota */ }
          }
        }
        if (cleanupState.messages.length > 0) {
          try { safeLocalStorage.setItem('gdream-messages-' + cleanupSid, JSON.stringify(cleanupState.messages)); } catch { /* quota */ }
        }
      }
      // Abort every per-agent DSH bridge, not just the active one — EXCEPT
      // when this cleanup was triggered by a settings change (e.g. the user
      // cleared all provider keys) rather than a real unmount: tearing down
      // mid-run would kill an active task. Recompute the flag from the store;
      // on unmount the keys are still there, on key-clear they are gone.
      const settingsNow = useSettingsStore.getState();
      const isRealUnmount = hasAnyChatProviderKey(settingsNow);
      for (const bridge of dshBridgesRef.current.values()) {
        for (const [agentId, shared] of sharedDshBridges) {
          if (shared === bridge) unregisterSharedDshBridge(agentId, bridge);
        }
        if (!isRealUnmount && bridge.getIsRunning()) deferredTeardownRef.current.push(bridge);
        else void bridge.abort();
      }
      dshBridgesRef.current.clear();
      coordinatorsRef.current.clear();
      coordinatorFactoryRef.current = null;
      baseCustomRulesRef.current = undefined;
      mcpManagerRef.current?.shutdown();
    };
  // LLM/model routing is resolved from the latest settings immediately before
  // every run. Do not rebuild the entire Agent engine when the user changes
  // provider/model/fallback order: cleanup aborts all coordinators and creates
  // a short but user-visible "API unavailable" race. Structural engine inputs
  // still rebuild normally.
  }, [hasConfiguredChatProvider]);

  // Provider keys, generation defaults and prompt contexts are hot settings.
  // Applying them must never tear down an active coordinator or Harness run.
  useEffect(() => {
    if (!hasConfiguredChatProvider) return;
    const settings = useSettingsStore.getState();
    void Promise.all([
      syncImageSlotsFile(settings),
      syncRunninghubKeyFile(settings),
    ]).catch((error) => agentLog.warn('Agent', `同步模型配置失败：${String(error)}`));
    for (const [agentId, coordinator] of coordinatorsRef.current) {
      const meta = settings.agentMetas[agentId];
      coordinator.setRuntimePromptConfig({
        customRules: buildAgentCustomRules(baseCustomRulesRef.current, settings, agentId),
        outputStyle: meta?.outputStyle ?? settings.outputStyle ?? 'default',
        imageApiContext: buildImageApiContext(settings),
        runninghubContext: buildRunninghubContext(settings),
      });
    }
    drainDeferredTeardown();
  }, [hasConfiguredChatProvider, imageSlotsSig, runninghubApiKey, chatImageModel, chatVideoModel]);

  // Update GLM client config when settings change
  useEffect(() => {
    if (glmClientRef.current && glmApiKey) {
      glmClientRef.current.updateConfig({
        apiKey: glmApiKey,
        baseUrl: glmBaseUrl || 'https://open.bigmodel.cn/api/anthropic',
        model: glmModel || 'glm-5.1',
      });
    }
  }, [glmApiKey, glmBaseUrl, glmModel]);

  // Push current AIGC project context into every coordinator's system prompt.
  // Re-runs whenever the user selects a different project or the project's
  // sources / stats / status change.
  useEffect(() => {
    const apply = () => {
      const project = useAigcProjectStore.getState().getCurrent();
      const context = buildAigcProjectContext(project);
      for (const c of coordinatorsRef.current.values()) {
        c.setAigcMemoryContext(context);
      }
    };
    apply();
    const unsub = useAigcProjectStore.subscribe(apply);
    return () => unsub();
  }, []);

  // 联网搜索开关切换时刷新各 coordinator 的系统提示词，
  // 让系统提示词里的工具清单同步增删 web_search（工具可见性本身由
  // getDefinitions per-turn 门控，此处仅同步提示词文本）。
  useEffect(() => {
    let prev = useSettingsStore.getState().webSearchEnabled;
    const unsub = useSettingsStore.subscribe((s) => {
      if (s.webSearchEnabled !== prev) {
        prev = s.webSearchEnabled;
        for (const c of coordinatorsRef.current.values()) c.refreshSystemPrompt();
      }
    });
    return () => unsub();
  }, []);

  /** 发送消息 */
  const sendMessage = useCallback(
    async (content: string, filePaths?: string[]) => {
      // Tier 4: pick the coordinator for the CURRENT agent. Lazy-init on first
      // use so non-main agents get their own coordinator only when actually
      // invoked. The factory closes over shared client/registry/skills, so
      // this is cheap.
      const currentAgentId = useChatStore.getState().currentAgent?.id || 'main';
      let coordinator = coordinatorsRef.current.get(currentAgentId);
      if (!coordinator && coordinatorFactoryRef.current) {
        coordinator = coordinatorFactoryRef.current(currentAgentId);
        coordinatorsRef.current.set(currentAgentId, coordinator);
        agentLog.info('Agent', `Spawned coordinator for agent ${currentAgentId}`);
      }
      if (!coordinator) {
        setError('Agent 引擎未初始化，请检查 API Key 设置');
        return;
      }
      // Secondary (wizard) engines share the global chat stores but must not
      // write session files — their coordinators hold wizard-scoped history
      // that would overwrite the real chat session's agent history on disk.
      const persistUiMessages: typeof persistMessages = isPrimary ? persistMessages : () => {};
      const displayContent = stripHarnessPrefix(content);
      const activeDsh = dshBridgesRef.current.get(currentAgentId);
      if (activeDsh?.getIsRunning()) {
        const pathPrefix = filePaths?.length
          ? `[用户补充了以下文件]\n${filePaths.map((path) => `- ${path}`).join('\n')}\n\n`
          : '';
        if (!activeDsh.queueGuidance(`${pathPrefix}${displayContent}`)) return;
        const sessionId = useChatStore.getState().currentSessionId;
        addMessage({
          id: randomUUID(),
          role: 'user',
          content: displayContent,
          metadata: { fullInput: content },
          filePaths: filePaths?.length ? filePaths : undefined,
          timestamp: Date.now(),
        });
        persistUiMessages(sessionId ?? undefined);
        return;
      }
      // Reset abort guard only when starting a genuinely new run. Doing this
      // for mid-run guidance would invalidate the active run's callbacks.
      setError(null);
      const settings = useSettingsStore.getState();
      const surface = inferAgentWorkspaceScope(content);
      const workspaceSelection = surface
        ? decodeChatModel(settings.workspaceAgentModels[surface])
        : null;
      const agentMeta = settings.agentMetas[currentAgentId];
      const routePlan = buildRoutePlanFromSettings(
        settings,
        resolveApiKey(settings, 'glm', settings.glmApiKey),
        agentMeta?.preferredProviderId,
        workspaceSelection,
      );
      const routeStrategy = routePlan.strategy;
      const primaryRoute = getPrimaryRouteSelection(routeStrategy);
      // Harness runs whichever model the composer shows. Each provider is
      // mapped to a pi-ai wire protocol; a provider GDream has no confirmed
      // protocol for is rejected rather than being
      // guessed at and failing mid-turn.
      const harnessModel = primaryRoute.modelId?.trim()
        || settings.providerModels[primaryRoute.providerId]?.trim()
        || getProvider(primaryRoute.providerId)?.defaultModelId
        || '';
      const harnessRouting = resolveDshProviderRouting({
        providerId: primaryRoute.providerId,
        baseUrl: settings.providerBaseUrls[primaryRoute.providerId],
        modelId: harnessModel,
      });
      // The runtime's own budget must match the model's real window: a
      // larger declared window suppresses compaction until the endpoint
      // rejects the request outright.
      const harnessContextWindow = resolveDshContextWindow(
        getProvider(primaryRoute.providerId)?.models.find((m) => m.id === harnessModel)?.contextWindow,
      );
      const harnessApiKey = resolveApiKey(
        settings,
        `provider:${primaryRoute.providerId}`,
        settings.providerApiKeys[primaryRoute.providerId] || '',
      ).trim();
      const usingHarness = Boolean(harnessRouting && harnessApiKey && harnessModel);
      // 所有候选渠道都缺 key 时不能静默改成别的渠道：Harness 用的是同一份
      // 选中渠道凭证，拿不到就说明这条路也走不通，必须明确报错。
      if (!usingHarness) {
        const blocked = !harnessRouting
          ? '所选渠道尚未接通 DSH 协议，请选择已支持的渠道；不会回退到其他执行引擎。'
          : !harnessApiKey ? 'DSH 缺少所选渠道的 API Key，请在设置中绑定凭证。'
          : 'DSH 缺少模型名称，请先选择模型。';
        setError(blocked);
        // 与 run 失败同理：只写 chatStore.error 的话，工坊/画布/剪辑/文案/导演台
        // 五个抽屉都看不到（它们只渲染消息列表），用户会以为「点了没反应」。
        // 这里补一条持久化的 system 提示：用户可见、可回看，但不进入模型上下文。
        addMessage({
          id: randomUUID(),
          role: 'system',
          content: blocked,
          timestamp: Date.now(),
        });
        persistUiMessages(useChatStore.getState().currentSessionId ?? undefined);
        return;
      }
      // 有 key 但选中的渠道缺 key：本次会在别的渠道上跑，必须告知而不是静默替换。
      const routeDeviationNotice = describeRouteDeviation(routePlan);
      if (routeDeviationNotice) {
        agentLog.warn('Agent', routeDeviationNotice);
        addMessage({
          id: randomUUID(),
          role: 'system',
          content: routeDeviationNotice,
          timestamp: Date.now(),
        });
      }
      coordinator.setRouteStrategy(routeStrategy);
      // Make this the "active" coordinator so abort/switchCwd/agent-tool
      // relay target the right instance.
      coordinatorRef.current = coordinator;

      // Check for slash commands. Drawer wrappers (canvas/workshop/editor)
      // prepend a "[用户正在…]\n\n" context prefix — strip it so /auto etc.
      // work from every chat surface.
      const now = Date.now();
      const lastSend = lastUiSendRef.current;
      if (lastSend && lastSend.content === displayContent && now - lastSend.at < 5000) {
        agentLog.warn('Agent', 'Dropped duplicate UI send within 5s');
        return;
      }
      lastUiSendRef.current = { content: displayContent, at: now };
      // Close the startup race: from here until DSH 启动 starts there
      // are awaits (slash command, session ensure, native media loading) during
      // which a second sendMessage would start a competing run on the same
      // coordinator — dropping the first message's final reply. Released in
      // the run's finally and on the early-return paths below.
      if (sendingRef.current) {
        agentLog.warn('Agent', 'Dropped concurrent send during startup window');
        return;
      }
      sendingRef.current = true;
      // Bump the run token only AFTER the duplicate/concurrent guards above.
      // Doing it earlier meant a dropped second send still invalidated the
      // active run's token — silencing all its callbacks, losing its final
      // reply, and leaving its run stuck in 'running'.
      userAbortedRef.current = false;
      const runToken = ++activeRunTokenRef.current;
      const isCurrentRun = () => activeRunTokenRef.current === runToken && !userAbortedRef.current;
      const cmdText = displayContent;
      if (cmdText.startsWith('/')) {
        let result: Awaited<ReturnType<typeof executeCommand>>;
        try {
          result = await executeCommand(cmdText, {
            coordinator,
            addSystemMessage: (msg) => {
              addMessage({
                id: randomUUID(),
                role: 'system',
                content: msg,
                timestamp: Date.now(),
              });
            },
            skillLoader: skillLoaderRef.current || undefined,
            mcpManager: mcpManagerRef.current || undefined,
            toolRegistry: coordinator.getToolRegistry(),
            apiKey: glmApiKey || undefined,
          });
        } catch (err) {
          sendingRef.current = false;
          throw err;
        }

        if (result.handled) {
          sendingRef.current = false;
          // Add command output as system message
          if (result.output) {
            addMessage({
              id: randomUUID(),
              role: 'assistant',
              content: result.output,
              timestamp: Date.now(),
            });
          }
          return;
        }
      }

      // A drawer and the main chat are two views of the same task. Recover a
      // temporarily lost active session before creating anything new.
      try {
        await ensureActiveConversationSessionRaw();
      } catch (err) {
        sendingRef.current = false;
        throw err;
      }

      // Lock sessionId now — any view switch after this point must NOT change
      // which session we write to. All persist/streaming callbacks use this value.
      const sessionId = useChatStore.getState().currentSessionId;
      activeRunSessionRef.current = sessionId;

      // Add user message to UI
      addMessage({
        id: randomUUID(),
        role: 'user',
        content: displayContent,
        metadata: { fullInput: content },
        filePaths: filePaths?.length ? filePaths : undefined,
        timestamp: Date.now(),
      });
      if (sessionId) {
        const attachmentTitle = filePaths?.[0] ? `查看 ${filePaths[0].split('/').pop() || '附件'}` : '新任务';
        ensureSessionTitleRaw(sessionId, displayContent || attachmentTitle);
      }

      // Atomic: reset content + set phase='waiting' + set isStreaming=true in ONE set() call
      // so React sees consistent state in a single re-render.
      const startTime = Date.now();
      startStreaming(sessionId);
      emit('agent-status-change', 'working');
      toolExecutionsRef.current = [];
      const runId = useRunStepStore.getState().startRun({
        sessionId: sessionId || 'unknown',
        projectId: useWorkshopStore.getState().data?.projectId,
        userRequest: content,
        modelProvider: primaryRoute.providerId,
        modelId: primaryRoute.modelId,
      });
      activeRunIdsRef.current.set(currentAgentId, runId);

      // Yield one frame so "正在思考..." renders before the network call
      await new Promise((r) => requestAnimationFrame(r));

      persistUiMessages(sessionId ?? undefined);

      // Snapshot cheaply here; compaction/stringify/disk IPC are coalesced and
      // run during browser idle time by agentMessagesSaveQueue.
      const persistAgentMsgs = () => {
        if (isPrimary && sessionId && coordinator) {
          saveAgentMessages(sessionId, coordinator.getMessages());
        }
      };

      let accumulatedText = '';
      let accumulatedThinking = '';
      let accumulatedSubAgent = '';
      let pendingLastTextAt: number | null = null;
      // Context-usage pill: only push a store update when the estimate moved
      // meaningfully — estimateMessages is cached, but a fresh object identity
      // every frame would still re-render pill subscribers for no visual change.

      // 流式文本会触发 Markdown、执行链和多个抽屉重排。限制到约 12fps，
      // 保持可读的流式感，同时给画布拖拽、看图和提示词点击留出主线程时间。
      let flushTimerId: number | null = null;
      let pendingPhase: 'thinking' | 'streaming' | null = null;

      const flushToStore = () => {
        flushTimerId = null;
        // Ghost-write guard: after abort, a pending 80ms flush must not
        // resurrect streaming state that abort() just cleared.
        if (!isCurrentRun()) return;
        // ONE Zustand set() per frame — merges phase, content, thinking, lastTextAt, subAgent
        const update: Record<string, unknown> = {
          streamingThinkingContent: accumulatedThinking,
          streamingContent: accumulatedText,
        };
        if (pendingPhase) {
          update.streamingPhase = pendingPhase;
          pendingPhase = null;
        }
        if (pendingLastTextAt !== null) {
          update.streamingLastTextAt = pendingLastTextAt;
          pendingLastTextAt = null;
        }
        if (accumulatedSubAgent) {
          update.streamingSubAgentText = accumulatedSubAgent;
        }

        useChatStore.setState(update);
      };

      const scheduleFlush = () => {
        if (flushTimerId !== null) return;
        flushTimerId = window.setTimeout(flushToStore, 80);
      };

      const cancelFlush = () => {
        if (flushTimerId !== null) {
          window.clearTimeout(flushTimerId);
          flushTimerId = null;
        }
      };
      // ────────────────────────────────────────────────────────────────

      const toolCallIds = new Map<string, string>();
      const callbacks: CoordinatorCallbacks = {
        onThinkingDelta: (text) => {
          if (!isCurrentRun()) return;
          accumulatedThinking += text;
          pendingPhase = 'thinking';
          scheduleFlush();
        },

        onTextDelta: (text) => {
          if (!isCurrentRun()) return;
          accumulatedText += text;
          pendingPhase = 'streaming';
          pendingLastTextAt = Date.now();
          scheduleFlush();
        },

        onProgressText: (text, displayText) => {
          if (!isCurrentRun()) return;
          const progress = displayText || text;
          if (text.trim() && !isTechnicalProgressText(text)) {
            useRunStepStore.getState().addProgressUpdate(progress, runId);
          } else {
            useRunStepStore.getState().upsertProgressUpdate('current-stage', progress, runId);
          }

          // The same text arrived through onTextDelta while the model was
          // streaming. Move it from the answer draft into the task log now
          // that the coordinator knows this turn continues with tools.
          if (text && accumulatedText.endsWith(text)) {
            accumulatedText = accumulatedText.slice(0, -text.length).trimEnd();
          }
          cancelFlush();
          flushToStore();
        },

        onToolBatchStart: (calls) => {
          if (!isCurrentRun()) return;
          useRunStepStore.getState().beginToolBatch(calls, runId);
        },

        onToolBatchEnd: (results) => {
          if (!isCurrentRun()) return;
          useRunStepStore.getState().finishToolBatch(results, runId);
        },

        onToolStart: (name, params, callId) => {
          if (!isCurrentRun()) return;
          // Tool events are infrequent — flush immediately
          cancelFlush();
          flushToStore();
          useChatStore.setState({
            streamingPhase: 'processing',
            streamingToolName: name,
          });

          const execution: ToolExecution = {
            id: useRunStepStore.getState().startTool(name, params as Record<string, unknown>, runId) || randomUUID(),
            toolName: name,
            params: params as Record<string, unknown>,
            status: 'running',
            startTime: Date.now(),
          };
          if (callId) toolCallIds.set(callId, execution.id);
          toolExecutionsRef.current = [...toolExecutionsRef.current, execution];
        },

        onToolEnd: (name, result, callId) => {
          if (!isCurrentRun()) return;
          useChatStore.setState({ streamingToolName: null });
          const running = [...toolExecutionsRef.current].reverse().find((te) =>
            callId ? te.id === toolCallIds.get(callId) : te.toolName === name && te.status === 'running'
          );
          useRunStepStore.getState().finishTool(running?.id ?? null, result.success, result, runId);
          const run = useRunStepStore.getState().runsById[runId];
          if (running && run) {
            const outcome = savedShotOutcome(name, running.params, result.success, useWorkshopStore.getState().data, run.projectId, running.id, result.output);
            if (outcome) useRunStepStore.getState().addOutcome(outcome, runId);
          }
          toolExecutionsRef.current = toolExecutionsRef.current.map((te) =>
            te.id === running?.id
              ? {
                  ...te,
                  status: result.success ? 'completed' : 'error',
                  result,
                  endTime: Date.now(),
                }
              : te,
          );
          persistAgentMsgs();
        },

        onComplete: (finalText) => {
          // If user already aborted, skip this callback — abort() already
          // cleaned up state and we don't want duplicate messages/notifications.
          if (!isCurrentRun()) return;

          // Cancel pending RAF and do a final sync flush
          cancelFlush();

          const duration = Math.floor((Date.now() - startTime) / 1000);
          // Add assistant message
          addMessage({
            id: randomUUID(),
            role: 'assistant',
            content: finalText || accumulatedText,
            thinkingContent: accumulatedThinking || undefined,
            timestamp: Date.now(),
            workingDuration: duration,
            metadata: {
              runId,
              ...(toolExecutionsRef.current.length > 0
                ? { toolExecutions: compactToolExecutionsForHistory(toolExecutionsRef.current) }
                : {}),
            },
          } as Message);

          persistUiMessages(sessionId ?? undefined);
          persistAgentMsgs();
          setIsStreaming(false);
          setStreamingSessionId(null);
          if (sessionId) setSessionStreaming(sessionId, false);
          clearStreamingContent();
          setStreamingPhase('idle');
          emit('agent-status-change', 'idle');
          useRunStepStore.getState().finishRun('done', runId);
          recordRunTrajectory('done', displayContent, startTime);

          // Tier 4: OS notification when window is unfocused. Skip very
          // short turns (<5s) — those are clearly already in front of the user.
          if (useSettingsStore.getState().notificationsEnabled && duration >= 5) {
            const preview = (finalText || accumulatedText).trim().slice(0, 80);
            void notify({
              title: `${useChatStore.getState().currentAgent?.name || 'GDream'} 已完成`,
              body: preview || '回复已生成',
            });
          }
        },

        onError: (error) => {
          // If user already aborted, skip this callback.
          if (!isCurrentRun()) return;

          cancelFlush();
          setError(error.message);
          // A failed run must leave a durable record. The global error pill is
          // only rendered by the main chat header, so without this the workshop
          // drawer (and any reload) showed nothing at all after a failure.
          // Aborts are already reported by the onComplete path.
          if (!isAbortFailure(error.message)) addMessage({
            id: randomUUID(),
            role: 'assistant',
            content: buildRunFailureNotice(error.message),
            timestamp: Date.now(),
            workingDuration: Math.floor((Date.now() - startTime) / 1000),
            metadata: {
              runId,
              runFailed: true,
              errorMessage: error.message,
              ...(toolExecutionsRef.current.length > 0
                ? { toolExecutions: compactToolExecutionsForHistory(toolExecutionsRef.current) }
                : {}),
            },
          } as Message);
          persistUiMessages(sessionId ?? undefined);
          persistAgentMsgs();
          setIsStreaming(false);
          setStreamingSessionId(null);
          if (sessionId) setSessionStreaming(sessionId, false);
          clearStreamingContent();
          setStreamingPhase('idle');
          emit('agent-status-change', 'error');
          useRunStepStore.getState().finishRun('failed', runId);
          recordRunTrajectory('failed', displayContent, startTime);

          if (useSettingsStore.getState().notificationsEnabled) {
            void notify({
              title: `${useChatStore.getState().currentAgent?.name || 'GDream'} 出错了`,
              body: error.message.slice(0, 120),
            });
          }
        },

        onToolConfirm: (name, params, reason) => {
          // 自动执行模式：跳过确认弹窗（bashSecurity 的 deny 裁决在 coordinator
          // 层先于此回调，危险命令仍会被拦）
          const id = randomUUID();
          const at = Date.now();
          const record = (status: 'pending' | 'answered' | 'cancelled', answer?: string) => {
            if (sessionId) useRunStepStore.getState().recordDecision({ id, at, title: '工具执行确认',
              questions: [`${name}：${reason || '请求执行此操作'}`], status,
              answers: answer ? [answer] : undefined, resolvedAt: status === 'pending' ? undefined : Date.now() }, sessionId);
          };
          if (useSettingsStore.getState().toolConfirmMode === 'auto') {
            record('answered', '按当前自动执行设置放行（不是用户本轮手动确认）');
            return Promise.resolve(true);
          }
          record('pending');
          return useToolConfirmStore.getState().requestConfirm(name, params, reason).then((allowed) => {
            record(allowed ? 'answered' : 'cancelled', allowed ? '用户允许' : '用户拒绝');
            return allowed;
          });
        },

        onSubAgentDelta: (text) => {
          if (!isCurrentRun()) return;
          accumulatedSubAgent += text;
          scheduleFlush();
        },

        onContextUsage: (stats) => {
          if (!isCurrentRun()) return;
          useChatStore.getState().setContextStats(stats);
        },

        onCompacting: () => {
          if (!isCurrentRun()) return;
          cancelFlush();
          flushToStore();
          persistAgentMsgs();
          useRunStepStore.getState().ensureSystemStep(
            '整理上下文',
            '正在整理较早的历史消息，避免重复内容拖慢后续操作。',
            runId,
          );
          useChatStore.setState({ streamingPhase: 'processing', streamingToolName: '整理上下文' });
        },

        // Unfinished-todo guard: when the model tries to end the turn while
        // the session's todo list still has open items, hand it one reminder
        // so multi-step tasks don't silently stop half-way (CC-style).
        shouldContinue: () => {
          if (!sessionId) return null;
          const todos = useTodoStore.getState().todosBySession[sessionId];
          if (!todos?.length) return null;
          const unfinished = todos.filter((t) => t.status !== 'completed');
          if (unfinished.length === 0) return null;
          const list = unfinished
            .map((t) => `- [${t.status === 'in_progress' ? '进行中' : '待处理'}] ${t.content}`)
            .join('\n');
          return (
            `[系统提醒] 你准备结束回复，但当前待办列表还有 ${unfinished.length} 项未完成：\n${list}\n` +
            '请继续完成这些事项；如果它们确实不需要做了，先用 todo_write 更新列表（标记完成或移除），再给出最终答复。'
          );
        },
      };

      // Periodic mid-stream snapshot. The global queue enforces the same
      // 15-second minimum across tool-completion bursts.
      const persistInterval = setInterval(persistAgentMsgs, 15000);
      try {
        // Prepend file paths to content so agent can see them
        let finalContent = content;
        if (filePaths?.length) {
          const pathList = filePaths.map(p => `- ${p}`).join('\n');
          finalContent = `[用户附加了以下文件，请根据需要读取]\n${pathList}\n\n${content}`;
        }
        let mediaBlocks: AgentUserContentBlock[] = [];
        const executionTask = resolveWorkshopExecutionTask(finalContent, useWorkshopStore.getState().data);
        {
          const bridge = new DshBridge();
          useDeepseekHarnessStore.getState().startRun(runId);
          dshBridgesRef.current.set(currentAgentId, bridge);
          registerSharedDshBridge(currentAgentId, bridge);
          try {
            const context = await coordinator.buildHarnessTurnContext(finalContent);
            const history = buildDshConversationContext(coordinator.getMessages());
            const input = context.turnContext
              ? `${context.turnContext}\n\n[用户请求]\n${finalContent}`
              : finalContent;
            if (filePaths?.length) mediaBlocks = await buildNativeMediaBlocks(filePaths);
            const acpMediaBlocks = mediaBlocks;
            const result = await bridge.run({
              executionTask,
              runId,
              apiKey: harnessApiKey,
              baseUrl: harnessRouting!.baseUrl,
              model: harnessModel,
              providerId: primaryRoute.providerId,
              protocol: harnessRouting!.protocol,
              wireModel: harnessRouting!.wireModelId || undefined,
              sendBearerAuth: harnessRouting!.sendBearerAuth,
              // DSH exposes GDream tools through its MCP bridge with a fixed
              // `mcp__gdream__` prefix (upstream naming invariant, cannot be
              // disabled). GDream's own prompts reference bare tool names, so
              // spell the mapping out to avoid first-turn `unknown tool`
              // errors observed in real sessions.
              persona: [
                context.systemPrompt,
                '[工具命名规则] 本会话中所有工具的实际名称都带有 mcp__gdream__ 前缀'
                  + '（例如 read_image 的完整名称是 mcp__gdream__read_image）。'
                  + '调用工具时必须使用工具列表里给出的完整名称，不要省略前缀。',
                history,
              ].filter(Boolean).join('\n\n'),
              workspace: coordinator.getCwd(),
              maxTokens: 32_768,
              contextWindow: harnessContextWindow,
              input,
              mediaBlocks: acpMediaBlocks,
              toolRegistry: coordinator.getToolRegistry(),
              callbacks,
            });
            coordinator.recordHarnessTurn(finalContent, result.text, result.thinking, mediaBlocks);
            persistAgentMsgs();
            callbacks.onComplete(result.text);
          } catch (error) {
            if (!isCurrentRun()) return;
            const normalized = error instanceof Error ? error : new Error(String(error));
            agentLog.error('DeepSeekHarness', normalized.message);
            callbacks.onError(normalized);
          } finally {
            useDeepseekHarnessStore.getState().finishRun(runId);
            if (dshBridgesRef.current.get(currentAgentId) === bridge) {
              dshBridgesRef.current.delete(currentAgentId);
            }
            unregisterSharedDshBridge(currentAgentId, bridge);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Same contract as onError: a run that dies outside the coordinator
        // callback must still leave a visible, persisted record.
        if (!isAbortFailure(message)) {
          addMessage({
            id: randomUUID(),
            role: 'assistant',
            content: buildRunFailureNotice(message),
            timestamp: Date.now(),
            workingDuration: startTime ? Math.floor((Date.now() - startTime) / 1000) : undefined,
            metadata: { runId, runFailed: true, errorMessage: message },
          } as Message);
        }
        persistUiMessages(sessionId ?? undefined);
        persistAgentMsgs();
        setError(message);
        setIsStreaming(false);
        setStreamingSessionId(null);
        if (sessionId) setSessionStreaming(sessionId, false);
        setStreamingPhase('idle');
        emit('agent-status-change', 'error');
        useRunStepStore.getState().finishRun('failed', runId);
      } finally {
        if (activeRunIdsRef.current.get(currentAgentId) === runId) {
          activeRunIdsRef.current.delete(currentAgentId);
        }
        activeRunSessionRef.current = null;
        sendingRef.current = false;
        drainDeferredTeardown();
        clearInterval(persistInterval);
        cancelFlush();
      }
    },
    [
      addMessage,
      setIsStreaming,
      clearStreamingContent,
      setStreamingPhase,
      setStreamingSessionId,
      setSessionStreaming,
      startStreaming,
      setError,
      persistMessages,
      recordRunTrajectory,
    ],
  );

  /** 中止操作（中止当前 agent 的 coordinator） */
  const abort = useCallback(() => {
    userAbortedRef.current = true; // prevent onComplete/onError from double-cleanup
    activeRunTokenRef.current += 1; // invalidate callbacks from the aborted run
    const currentAgentId = useChatStore.getState().currentAgent?.id || 'main';
    // Prefer the agent the user is looking at, but if it has no active run,
    // fall back to the one agent that actually does — a Stop click right
    // after switching panels must stop the run the user means, and must
    // never finish a run that belongs to another agent or a background
    // background run.
    let targetAgentId = currentAgentId;
    let activeRunId = activeRunIdsRef.current.get(currentAgentId);
    let activeDsh = dshBridgesRef.current.get(currentAgentId)
      ?? getSharedDshBridge(currentAgentId);
    if (!activeRunId && !activeDsh) {
      const candidates = [...new Set([
        ...activeRunIdsRef.current.keys(),
        ...dshBridgesRef.current.keys(),
      ])];
      if (candidates.length === 1) {
        targetAgentId = candidates[0];
        activeRunId = activeRunIdsRef.current.get(targetAgentId);
        activeDsh = dshBridgesRef.current.get(targetAgentId)
          ?? getSharedDshBridge(targetAgentId);
      }
    }
    if (activeDsh) {
      void activeDsh.abort();
      for (const [agentId, shared] of sharedDshBridges) {
        if (shared === activeDsh) unregisterSharedDshBridge(agentId, activeDsh);
      }
      for (const [agentId, bridge] of dshBridgesRef.current) {
        if (bridge === activeDsh) dshBridgesRef.current.delete(agentId);
      }
    }
    const c = coordinatorsRef.current.get(targetAgentId)
      ?? (coordinatorRef.current && coordinatorsRef.current.size <= 1
        ? coordinatorRef.current
        : undefined);
    let savedAgentMessages: ReturnType<AgentCoordinator['getMessages']> | null = null;
    // Persist coordinator state before abort so partial results are saved
    if (c) {
      const abortState = useChatStore.getState();
      const abortSid = abortState.currentSessionId;
      if (abortSid) {
        // The snapshot may catch the run mid-tool-execution (assistant
        // tool_calls pushed, results not yet). Persisting that verbatim
        // poisons the session file — OpenAI-style endpoints 400 on every
        // later request. Repair pairs before persisting/restoring.
        const rawMessages = repairToolPairingSnapshot(c.getMessages());
        const cachedMessages = compactAgentMessagesForStorage(rawMessages);
        savedAgentMessages = rawMessages;
        if (cachedMessages.length > 1) {
          try { safeLocalStorage.setItem(AGENT_MSGS_PREFIX + abortSid, JSON.stringify(cachedMessages)); } catch { /* quota */ }
        }
        if (abortState.messages.length > 0) {
          try { safeLocalStorage.setItem('gdream-messages-' + abortSid, JSON.stringify(abortState.messages)); } catch { /* quota */ }
        }
        // Mirror to disk so a force-quit right after abort doesn't lose state.
        void flushAgentMessages(abortSid, rawMessages);
      }
    }
    const fresh = coordinatorFactoryRef.current?.(targetAgentId);
    if (fresh) {
      if (savedAgentMessages?.length) {
        void fresh.restoreMessages(savedAgentMessages);
      }
      coordinatorsRef.current.set(targetAgentId, fresh);
      coordinatorRef.current = fresh;
      agentLog.info('Agent', `Replaced coordinator for ${targetAgentId} after abort`);
    }
    // Immediately clear ALL streaming state — no timeout, no waiting
    setIsStreaming(false);
    setStreamingPhase('idle');
    const sid = useChatStore.getState().streamingSessionId;
    if (sid) {
      useChatStore.getState().setStreamingSessionId(null);
      useChatStore.getState().setSessionStreaming(sid, false);
      useChatStore.getState().clearStreamingContent();
    }
    emit('agent-status-change', 'idle');
    // Only finish the run we actually targeted. Without an activeRunId there
    // is nothing of ours to close — calling finishRun without a runId would
    // stamp 'aborted' onto whatever run holds the global currentRunId slot
    // (another agent, or a background run).
    if (activeRunId) {
      useRunStepStore.getState().finishRun('aborted', activeRunId);
      activeRunIdsRef.current.delete(targetAgentId);
    }
    // Aborts are a user-dissatisfaction signal — feed the evolution journal.
    const lastUserMsg = [...useChatStore.getState().messages].reverse().find((m) => m.role === 'user');
    recordRunTrajectory('aborted', lastUserMsg?.content || '', useChatStore.getState().streamingSentAt);
  }, [setIsStreaming, setStreamingPhase, recordRunTrajectory]);

  /** 切换工作目录（应用到所有 agent 的 coordinator） */
  const switchCwd = useCallback((cwd: string) => {
    for (const c of coordinatorsRef.current.values()) c.setCwd(cwd);
  }, []);

  /** 清空对话（仅当前 agent） */
  const clearConversation = useCallback(() => {
    const currentAgentId = useChatStore.getState().currentAgent?.id || 'main';
    coordinatorsRef.current.get(currentAgentId)?.clear();
  }, []);

  /** 获取 token 使用量（当前 agent） */
  const getTokenUsage = useCallback((): TokenUsage | null => {
    const currentAgentId = useChatStore.getState().currentAgent?.id || 'main';
    return coordinatorsRef.current.get(currentAgentId)?.getTokenUsage() || null;
  }, []);

  /** 恢复会话上下文到对应 agent 的 coordinator（切换会话时调用） */
  const restoreSession = useCallback(async (sessionId: string) => {
    // Sequence guard: restores contain slow awaits (file reads, and an LLM
    // compact inside restoreMessages). Two rapid session switches interleave;
    // without this, an older restore can finish LAST and overwrite the newer
    // session's messages — UI shows session B while the coordinator holds A.
    const seq = ++restoreSeqRef.current;
    const isStale = () => seq !== restoreSeqRef.current;
    // Session id format: `agent:{agentId}:{uuid}`. Pick the matching agent.
    const parts = sessionId.split(':');
    const agentId = parts.length >= 3 && parts[0] === 'agent' ? parts[1] : 'main';
    if ((dshBridgesRef.current.get(agentId) ?? getSharedDshBridge(agentId))?.getIsRunning()) {
      agentLog.warn('Agent', `Session switch: DeepSeek Harness for ${agentId} is running, deferring restore`);
      return;
    }
    let coordinator = coordinatorsRef.current.get(agentId);
    if (!coordinator && coordinatorFactoryRef.current) {
      coordinator = coordinatorFactoryRef.current(agentId);
      coordinatorsRef.current.set(agentId, coordinator);
    }
    if (!coordinator) return;
    coordinatorRef.current = coordinator;

    let saved = loadAgentMessages(sessionId);
    if (saved === null) {
      const fromFile = await readSessionFromFile(sessionId);
      if (isStale()) return;
      if (fromFile) {
        hydrateLocalStorageSession(sessionId, fromFile);
        saved = fromFile.agentMessages;
      } else {
        saved = [];
      }
    }
    // Recheck DSH after disk awaits: a task may have started during loading.
    if ((dshBridgesRef.current.get(agentId) ?? getSharedDshBridge(agentId))?.getIsRunning()) {
      agentLog.warn('Agent', `Session switch: ${agentId} is running, deferring restore`);
      return;
    }
    if (saved.length > 0) {
      let uiMsgs = readMessagesFromLocalStorage(sessionId);
      if (uiMsgs === null) {
        const fromFile = await readSessionFromFile(sessionId);
        if (isStale()) return;
        uiMsgs = fromFile?.messages ?? [];
      }
      const recovered = recoverDegradedAgentHistory(saved, uiMsgs);
      coordinator.clear();
      await coordinator.restoreMessages(recovered);
      if (isStale()) return;
      if (recovered !== saved) {
        saveAgentMessages(sessionId, recovered);
        agentLog.warn('Agent', `Session switch: rebuilt degraded history from visible chat for ${agentId}`);
      } else {
        agentLog.info('Agent', `Session switch: restored ${saved.length} agent messages for ${agentId}`);
      }
    } else {
      // Fallback: agent-messages key missing but UI messages may still exist
      // (storage eviction, dev↔prod origin switch). Read UI messages for
      // THIS session id (not chatStore — that still holds the previous
      // session's messages at this point in the load flow).
      let uiMsgs = readMessagesFromLocalStorage(sessionId);
      if (uiMsgs === null) {
        const fromFile = await readSessionFromFile(sessionId);
        if (isStale()) return;
        uiMsgs = fromFile?.messages ?? [];
      }
      if (uiMsgs.length > 0) {
        const projected = projectUIMessagesToAgentMessages(uiMsgs);
        coordinator.clear();
        if (projected.length > 0) {
          await coordinator.restoreMessages(projected);
          if (isStale()) return;
          agentLog.warn('Agent', `Session switch: rebuilt ${projected.length} agent msgs from UI for ${agentId}`);
        }
      } else {
        coordinator.clear();
        agentLog.info('Agent', `Session switch: ${agentId} starting fresh`);
      }
    }
    // Refresh the context-usage pill for the newly active conversation.
    useChatStore.getState().setContextStats(coordinator.getContextStats());
  }, []);

  // 注册到 useSessions 的回调，确保切换会话时 coordinator 同步。
  // 仅主实例注册——次级实例（技能向导）注册会劫持会话恢复，导致主聊天
  // 切换会话后 coordinator 不再更新、历史串台。
  useEffect(() => {
    if (!isPrimary) return;
    setCoordinatorRestoreCallback(restoreSession);
  }, [restoreSession, isPrimary]);

  return {
    isReady,
    sendMessage,
    abort,
    switchCwd,
    clearConversation,
    getTokenUsage,
    restoreSession,
    deleteAgentMessages,
    toolExecutions: toolExecutionsRef.current,
    skills: skillLoaderRef.current?.getAll() || [],
  };
}
