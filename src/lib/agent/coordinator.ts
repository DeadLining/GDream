import type {
  AgentMessage,
  AgentUserContentBlock,
} from './types';
import type { GLMClient } from './glmClient';
import type { ToolRegistry } from './toolRegistry';
import { ContextManager } from './contextManager';
import { buildSystemPrompt, type OutputStyle } from './systemPrompt';
import { agentLog } from './logger';
import { chatWithFallback, type RouteStrategy } from './providers/router';
import { findRelevantMemories, loadMemoryBodies } from './findRelevantMemories';
import { resolveEpisodeScriptTask, buildEpisodeScriptTaskContext } from '../workshop/episodeScriptTask';
import { shouldAutoCompact, getEffectiveContextWindowSize } from './autoCompact';
import { getProvider } from './providers/registry';
import { buildTemporalTurnContext, isTimeSensitiveQuery } from './temporalContext';
import { useWorkshopStore } from '@/stores/workshopStore';

export interface CoordinatorConfig {
  glmClient: GLMClient;
  toolRegistry: ToolRegistry;
  cwd: string;
  os?: string;
  shell?: string;
  skillDescriptions?: string;
  /** Rebuild the compact skill catalog for the current request and workspace. */
  skillDescriptionResolver?: (query: string) => string | undefined;
  /**
   * Resolve a transient per-run skill-relevance notice. Delivered as a
   * one-run user-message attachment (like memory), never enters the system
   * prompt, keeping the cached prefix byte-stable across turns.
   */
  skillNoticeResolver?: (query: string) => string | null;
  workspace?: string;
  customRules?: string;
  /** Provider selection for context sizing and history compaction; not a task engine. */
  routeStrategy?: RouteStrategy;
  /** Tier 4: response tone/style override. Defaults to 'default' (no extra). */
  outputStyle?: OutputStyle;
  /** 生图 API 上下文（注入 system prompt） */
  imageApiContext?: string;
  /** RunningHub API 上下文 */
  runninghubContext?: string;
  /** AIGC 记忆与导演视角上下文 */
  aigcMemoryContext?: string;
}

/**
 * Repair interrupted tool pairs in persisted history, including legacy sessions.
 * Synthesizes is_error results for tool calls whose results never landed,
 * so the snapshot is API-legal for both
 * Anthropic and OpenAI style endpoints.
 */
export function repairToolPairingSnapshot(messages: AgentMessage[]): AgentMessage[] {
  let assistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && (msg as { tool_calls?: unknown[] }).tool_calls) {
      assistantIdx = i;
      break;
    }
    if (msg.role === 'user') break;
  }
  if (assistantIdx === -1) return messages;

  const assistantMsg = messages[assistantIdx] as { tool_calls?: { id: string }[] };
  const expectedIds = new Set(assistantMsg.tool_calls?.map((tc) => tc.id) || []);
  const actualIds = new Set<string>();
  for (let i = assistantIdx + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'tool') actualIds.add((msg as { tool_call_id: string }).tool_call_id);
  }
  if (expectedIds.size === actualIds.size) return messages;

  const repaired = messages.slice();
  for (const id of expectedIds) {
    if (!actualIds.has(id)) {
      repaired.push({
        role: 'tool',
        tool_call_id: id,
        content: JSON.stringify({ error: '工具执行被中断（用户中止或发生错误）', is_error: true }),
      });
    }
  }
  return repaired;
}

/** DSH context/history adapter. User task execution belongs exclusively to DshBridge. */
export class AgentCoordinator {
  private messages: AgentMessage[] = [];
  private config: CoordinatorConfig;
  private contextManager: ContextManager;
  /** Invalidates async history restoration when a newer restore/run/clear wins. */
  private historyRevision = 0;
  constructor(config: CoordinatorConfig) {
    this.config = { ...config };
    this.contextManager = new ContextManager();
    // 根据当前模型设置正确的上下文窗口
    const { effectiveWindow } = this.resolveModelAndWindow();
    this.contextManager.updateMaxTokens(effectiveWindow);
    this.messages = [{ role: 'system', content: this.buildPrompt() }];
  }

  private resolveModelAndWindow(): { modelId: string; effectiveWindow: number } {
    let modelId: string;
    let providerId: string | undefined;
    if (this.config.routeStrategy) {
      const s = this.config.routeStrategy;
      if (s.kind === 'primary') {
        providerId = s.providerId;
        modelId = s.modelId ?? getProvider(s.providerId)?.defaultModelId ?? 'glm-5.1';
      } else if (s.kind === 'fallback_chain' && s.chain[0]) {
        providerId = s.chain[0].providerId;
        modelId = s.chain[0].modelId ?? getProvider(s.chain[0].providerId)?.defaultModelId ?? 'glm-5.1';
      } else {
        modelId = 'glm-5.1';
      }
    } else {
      modelId = (this.config.glmClient as unknown as { config?: { model?: string } })
        .config?.model ?? 'glm-5.1';
    }
    const declaredWindow = providerId
      ? getProvider(providerId)?.models.find((model) => model.id === modelId)?.contextWindow
      : undefined;
    return {
      modelId,
      effectiveWindow: getEffectiveContextWindowSize(modelId, declaredWindow),
    };
  }

  private resolvePrimaryProviderId(): string | undefined {
    const s = this.config.routeStrategy;
    if (!s) return 'glm';
    if (s.kind === 'primary') return s.providerId;
    if (s.kind === 'fallback_chain') return s.chain[0]?.providerId;
    return undefined;
  }

  private hardContextBudget(): number {
    const { effectiveWindow } = this.resolveModelAndWindow();
    // Reserve room for completion tokens, tool schema overhead, provider-side
    // message framing, and tokenizer differences. DeepSeek's API rejects the
    // whole request when messages + max_tokens exceed the model limit.
    return Math.floor(effectiveWindow * (effectiveWindow >= 900_000 ? 0.94 : 0.72));
  }

  private enforceHardContextBudget(reason: string): void {
    const before = this.contextManager.estimateMessages(this.messages);
    const budget = this.hardContextBudget();
    if (before <= budget) return;
    this.messages = this.contextManager.hardClamp(this.messages, budget);
    const after = this.contextManager.estimateMessages(this.messages);
    agentLog.warn('Coordinator', `Hard context budget enforced (${reason}): ${before} → ${after}/${budget}`);
  }

  /** 构建完整系统提示词（单一来源，避免参数遗漏） */
  private buildPrompt(): string {
    return buildSystemPrompt({
      cwd: this.config.cwd,
      os: this.config.os || 'macOS',
      shell: this.config.shell || 'zsh',
      skillDescriptions: this.config.skillDescriptions,
      workspace: this.config.workspace,
      customRules: this.config.customRules,
      outputStyle: this.config.outputStyle,
      imageApiContext: this.config.imageApiContext,
      runninghubContext: this.config.runninghubContext,
      aigcMemoryContext: this.config.aigcMemoryContext,
      primaryProviderId: this.resolvePrimaryProviderId(),
    });
  }

  /**
   * Build the request-scoped context consumed by the external DeepSeek
   * Harness, including prompt, skill, temporal and memory policies.
   */
  async buildHarnessTurnContext(userInput: string): Promise<{
    systemPrompt: string;
    turnContext: string;
  }> {
    this.historyRevision += 1;
    this.refreshScopedSkills(userInput);
    const additions: string[] = [];
    const episodeTask = resolveEpisodeScriptTask(userInput, useWorkshopStore.getState().data);
    if (episodeTask) additions.push(buildEpisodeScriptTaskContext(episodeTask, useWorkshopStore.getState().data));
    if (isTimeSensitiveQuery(userInput)) additions.push(buildTemporalTurnContext());
    try {
      const notice = this.config.skillNoticeResolver?.(userInput);
      if (notice) additions.push(notice);
    } catch (err) {
      agentLog.debug('Coordinator', 'Harness skill notice skipped', err);
    }
    try {
      const ranked = await findRelevantMemories(userInput, 4);
      if (ranked.length > 0) {
        const bodies = await loadMemoryBodies(ranked);
        if (bodies.length > 0) {
          additions.push(`[相关记忆 — 仅用于本轮参考，无需回应此消息]\n\n${bodies.join('\n\n---\n\n')}`);
        }
      }
    } catch (err) {
      agentLog.debug('Coordinator', 'Harness memory recall skipped', err);
    }
    return {
      systemPrompt: this.buildPrompt(),
      turnContext: additions.join('\n\n'),
    };
  }

  /** Keep existing session persistence authoritative after a DSH turn. */
  recordHarnessTurn(
    userInput: string,
    assistantText: string,
    reasoning?: string,
    mediaBlocks: AgentUserContentBlock[] = [],
  ): void {
    this.historyRevision += 1;
    this.messages.push({
      role: 'user',
      content: mediaBlocks.length > 0
        ? [...mediaBlocks, { type: 'text', text: userInput }]
        : userInput,
    });
    this.messages.push({
      role: 'assistant',
      content: assistantText,
      ...(reasoning ? { reasoning_content: reasoning } : {}),
    });
    this.enforceHardContextBudget('harness-turn');
  }

  private refreshScopedSkills(query: string): void {
    const resolver = this.config.skillDescriptionResolver;
    if (!resolver) return;
    const next = resolver(query);
    if (next === this.config.skillDescriptions) return;
    this.config.skillDescriptions = next;
    this.refreshSystemPrompt();
  }

  private getCompactChatClient() {
    if (!this.config.routeStrategy) {
      return this.config.glmClient;
    }
    return {
      chat: (
        messages: { role: string; content: string }[],
        options?: { maxTokens?: number },
      ) =>
        chatWithFallback(
          this.config.routeStrategy!,
          { messages, maxTokens: options?.maxTokens },
          {
            source: 'background',
          },
        ),
    };
  }

  /** 刷新系统提示词（用于 MCP 工具动态加载后更新，保留对话历史） */
  refreshSystemPrompt(): void {
    const systemPrompt = this.buildPrompt();
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0] = { role: 'system', content: systemPrompt };
    } else {
      this.messages.unshift({ role: 'system', content: systemPrompt });
    }
  }

  /** 更新工作目录 */
  setCwd(cwd: string, workspace?: string): void {
    this.config.cwd = cwd;
    if (workspace !== undefined) this.config.workspace = workspace;
    this.refreshSystemPrompt();
  }

  /** Read-only workspace accessor for external Agent runtimes. */
  getCwd(): string {
    return this.config.cwd;
  }

  /** 更新 AIGC 导演视角上下文，刷新系统提示词 */
  setAigcMemoryContext(context: string | undefined): void {
    this.config.aigcMemoryContext = context;
    this.refreshSystemPrompt();
  }

  /** Refresh prompt-only settings without rebuilding or aborting this coordinator. */
  setRuntimePromptConfig(config: {
    customRules?: string;
    outputStyle?: OutputStyle;
    imageApiContext?: string;
    runninghubContext?: string;
  }): void {
    this.config.customRules = config.customRules;
    this.config.outputStyle = config.outputStyle;
    this.config.imageApiContext = config.imageApiContext;
    this.config.runninghubContext = config.runninghubContext;
    this.refreshSystemPrompt();
  }

  /** Switch the LLM route for the next turn without losing conversation state. */
  setRouteStrategy(strategy: RouteStrategy | undefined): void {
    this.config.routeStrategy = strategy;
    const { effectiveWindow } = this.resolveModelAndWindow();
    this.contextManager.updateMaxTokens(effectiveWindow);
    this.refreshSystemPrompt();
  }

  /** 清空对话历史 (保留系统提示词) */
  clear(): void {
    this.historyRevision += 1;
    const system = this.messages.filter((m) => m.role === 'system');
    this.messages = system;
    this.contextManager.resetUsage();
  }

  /** 强制压缩上下文（忽略阈值），用于 /compact 命令 */
  async compactNow(): Promise<void> {
    const revision = ++this.historyRevision;
    const { effectiveWindow } = this.resolveModelAndWindow();
    this.contextManager.updateMaxTokens(effectiveWindow);
    const before = this.messages.length;
    const compacted = await this.contextManager.compact(this.messages, this.getCompactChatClient(), true);
    if (revision !== this.historyRevision) return;
    this.messages = compacted;
    const after = this.messages.length;
    agentLog.info('Coordinator', `CompactNow: ${before} → ${after} messages`);
  }

  /**
   * 从持久化的 AgentMessage[] 恢复上下文。
   * 保留当前 system prompt，注入历史消息，过多时自动 compact。
   */
  async restoreMessages(savedMessages: AgentMessage[]): Promise<void> {
    const revision = ++this.historyRevision;
    // 保留当前 system prompt
    const system = this.messages.filter((m) => m.role === 'system');
    // 过滤掉已保存的 system 消息（避免重复）
    const nonSystem = savedMessages.filter((m) => m.role !== 'system');

    if (nonSystem.length === 0) return;

    this.messages = [...system, ...nonSystem];
    agentLog.info('Coordinator', `Restored ${nonSystem.length} messages from history`);

    // 根据当前模型设置正确的上下文窗口，再做 compact 检查
    const { effectiveWindow } = this.resolveModelAndWindow();
    this.contextManager.updateMaxTokens(effectiveWindow);

    // 恢复历史时先静默清掉可重建的大型工具结果，再按当前模型真实窗口判断。
    const restored = this.contextManager.microcompact(this.messages);
    this.messages = restored;
    const { modelId } = this.resolveModelAndWindow();
    if (shouldAutoCompact(this.contextManager.estimateMessages(restored), modelId).compact) {
      agentLog.info('Coordinator', `Post-restore compact triggered`);
      const compacted = await this.contextManager.compact(restored, this.getCompactChatClient(), true);
      if (revision !== this.historyRevision) {
        agentLog.info('Coordinator', 'Discarded stale post-restore compaction');
        return;
      }
      this.messages = compacted;
    }
  }

  /** 获取消息历史 */
  getMessages(): AgentMessage[] {
    return this.messages.map((message) => {
      if (message.role === 'tool' && message.media?.length) {
        return { role: 'tool', tool_call_id: message.tool_call_id, content: message.content };
      }
      if (message.role !== 'user' || !Array.isArray(message.content)) return message;
      return {
        ...message,
        content: message.content.map((block) => {
          if (block.type === 'text') return block;
          if (block.type === 'image' && block.source.type === 'url') return block;
          return {
            type: 'text' as const,
            text: block.type === 'video'
              ? '[视频附件未写入会话文件；路径见本轮文字。]'
              : '[本地图片附件未写入会话文件；路径见本轮文字。]',
          };
        }),
      };
    });
  }

  /** 获取 token 使用统计 */
  getTokenUsage() {
    return this.contextManager.getUsage();
  }

  /**
   * 当前上下文占用快照（本地估算值 / 有效窗口），供 UI 显示上下文用量。
   * estimateMessages 带逐消息缓存，频繁调用开销可忽略。
   */
  getContextStats(): { estimatedTokens: number; maxTokens: number } {
    const { effectiveWindow } = this.resolveModelAndWindow();
    return {
      estimatedTokens: this.contextManager.estimateMessages(this.messages),
      maxTokens: effectiveWindow,
    };
  }

  /** 获取工具注册表 */
  getToolRegistry(): ToolRegistry {
    return this.config.toolRegistry;
  }
}
