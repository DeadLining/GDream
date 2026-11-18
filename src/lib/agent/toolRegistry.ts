import type { Tool, ToolDefinition, ToolResult, ToolExecutionContext } from './types';
import { agentLog } from './logger';
import { isToolEnabled } from './toolGating';
import { RepeatReadMemo } from './repeatReadGuard';
import { useChatStore } from '@/stores/chatStore';
import { useWorkshopStore } from '@/stores/workshopStore';

const TOOL_TEXT_DESCRIPTION_LIMIT = 900;
const TOOL_TEXT_PARAM_DESCRIPTION_LIMIT = 220;

/**
 * Stop must not wait for a native/MCP tool promise to resolve. Some tools
 * (notably Tauri file reads) cannot cancel the underlying IPC call, but the
 * agent loop must stop immediately and must not issue another read/tool call.
 */
export function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      // Observe late rejection from an uncancellable native promise.
      void promise.catch(() => undefined);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function trimForPrompt(text: string | undefined, limit: number): string {
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}...（详见 function schema，按需调用工具获取完整说明）` : text;
}

function viewHintForTool(name: string): string | null {
  const activeView = useChatStore.getState().activeView;
  if (name.startsWith('timeline_')) return `工具 ${name} 属于「剪辑」视图，当前视图是「${activeView}」。请先让用户切到剪辑，或改用当前视图可用工具。`;
  if (name.startsWith('workshop_')) return `工具 ${name} 属于「工坊」视图，当前视图是「${activeView}」。请先让用户切到工坊，或改用当前视图可用工具。`;
  if (name.startsWith('canvas_')) return `工具 ${name} 通常用于「画布」视图；当前视图是「${activeView}」。如果工具不可见，请切到画布后重试。`;
  return null;
}

/**
 * 工具注册表 — 管理所有可用工具
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  /** 一次运行内记忆已经读过的状态，避免模型写完还反复复读。 */
  private repeatReads = new RepeatReadMemo();

  /** data 引用 → 单调递增的世代号。引用一变即视为状态已变。 */
  private workshopSnapshotRef: unknown = null;
  private workshopSnapshotId = 0;

  /**
   * 工坊数据快照标识：`data` 引用变化即视为状态已变
   * （`workshopStore` 每次写入都换 `data` 引用，UI 改动同样如此）。
   * 工坊没打开时返回 null，退化为「只按工具写入 + run 作用域」的旧行为。
   */
  private workshopSnapshot(): string | null {
    const data = useWorkshopStore.getState().data;
    if (!data) return null;
    if (data !== this.workshopSnapshotRef) {
      this.workshopSnapshotRef = data;
      this.workshopSnapshotId += 1;
    }
    return `${data.projectId}#${this.workshopSnapshotId}`;
  }

  /**
   * 每次 run 开始时清空读记忆。
   *
   * registry 在引擎初始化时创建一次并被所有 coordinator 与会话共享，
   * 若不在 run 边界重置，上一个任务读过的状态会让下一个任务的第一次读取
   * 直接拿到「没有变化」，各步的前置校验因此失去依据。
   */
  resetRepeatReads(): void {
    this.repeatReads.reset();
  }

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 移除名称以指定前缀开头的所有工具（用于 MCP 热重载） */
  unregisterByPrefix(prefix: string): number {
    let count = 0;
    for (const name of Array.from(this.tools.keys())) {
      if (name.startsWith(prefix + '_') || name.startsWith(prefix)) {
        this.tools.delete(name);
        count++;
      }
    }
    return count;
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 为单个远程会话创建隔离的注册表。工具实现本身保持共享，但会话临时
   * 工具（例如 send_file_to_user）不会再覆盖其他联系人的目标上下文。
   */
  clone(): ToolRegistry {
    const registry = new ToolRegistry();
    for (const tool of this.tools.values()) registry.register(tool);
    return registry;
  }

  /** 运行期对模型可见的工具（应用 toolGating 门控） */
  getEnabled(): Tool[] {
    return this.getAll().filter((t) => isToolEnabled(t.definition.name));
  }

  /** 获取所有工具定义 (用于传给 GLM API) */
  getDefinitions(): ToolDefinition[] {
    return this.getEnabled().map((t) => t.resolveDefinition?.() ?? t.definition);
  }

  /** 执行工具 */
  async execute(
    name: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const guarded = context?.beforeExecute?.(name, params);
    if (guarded) return guarded;
    const tool = this.tools.get(name);
    if (!tool) {
      agentLog.warn('Tool', `Unknown tool: ${name}`);
      const hint = viewHintForTool(name);
      return {
        success: false,
        output: '',
        error: hint ? `Unknown tool: ${name}. ${hint}` : `Unknown tool: ${name}`,
      };
    }

    const start = Date.now();
    agentLog.info('Tool', `→ ${name}`, params);

    // 仅对 RepeatReadMemo 登记的工具短路；workshop_get_state 必须返回数据，
    // 分页恢复/压缩后重读不可用“没有变化”替代。其余同名同参数的只读工具直接回一句
    // 「没有变化」。写入会清空记忆，所以「写完再读一次确认」不受影响。
    //
    // 快照绑定：除工具写入外，用户在 UI 里直接改、reload 磁盘、别的窗口写入
    // 也会改工坊数据。把工坊 data 引用当成快照一并比对，才不会拿过期状态作答。
    const snapshot = this.workshopSnapshot();
    const repeatNotice = this.repeatReads.check(name, params, snapshot);
    if (repeatNotice) {
      agentLog.info('Tool', `↺ ${name} 重复读取，已短路（未实际执行）`);
      return { success: true, output: repeatNotice };
    }

    try {
      const result = await awaitWithAbort(tool.execute(params, signal, context), signal);
      this.repeatReads.record(name, params, result.success, this.workshopSnapshot());
      const ms = Date.now() - start;
      if (result.success) {
        agentLog.info('Tool', `← ${name} OK (${ms}ms, ${result.output.length} chars)`);
      } else {
        agentLog.error('Tool', `← ${name} FAIL (${ms}ms): ${result.error}`);
      }
      return result;
    } catch (err) {
      if (signal?.aborted) throw err;
      const ms = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      agentLog.error('Tool', `← ${name} THROW (${ms}ms): ${msg}`);
      return {
        success: false,
        output: '',
        error: msg,
      };
    }
  }

  /** 获取工具描述文本 (用于系统提示词) */
  getDescriptionText(): string {
    return this.getEnabled()
      .map((t) => {
        const definition = t.resolveDefinition?.() ?? t.definition;
        const params = Object.entries(definition.parameters.properties || {})
          .map(([k, v]) => `    - ${k} (${v.type}): ${trimForPrompt(v.description, TOOL_TEXT_PARAM_DESCRIPTION_LIMIT)}`)
          .join('\n');
        const required = definition.parameters.required?.join(', ') || '';
        return `- **${definition.name}**: ${trimForPrompt(definition.description, TOOL_TEXT_DESCRIPTION_LIMIT)}\n  参数:\n${params}\n  必填: ${required}`;
      })
      .join('\n\n');
  }
}

// Import all built-in tools
import { bashReadOutputTool, bashTool } from './tools/bashTool';
import { readTool } from './tools/readTool';
import { writeTool } from './tools/writeTool';
import { editTool } from './tools/editTool';
import { globTool } from './tools/globTool';
import { grepTool } from './tools/grepTool';
import { listDirectoryTool } from './tools/listDirectoryTool';
import { allCanvasTools } from './tools/canvasTools';
import {
  canvasGenerateBatchTool,
  canvasGenerateTool,
  mgReferenceVideoGenerateTool,
  mgTextFallbackGenerateTool,
} from './tools/canvasGenerateTool';
import { canvasTranscribeTool } from './tools/canvasTranscribeTool';
import { allTimelineTools } from './tools/timelineTools';
import { allWorkshopTools } from './tools/workshopTools';
import { askUserQuestionTool } from './tools/askUserQuestionTool';
import { skillInvokeTool } from './tools/skillInvokeTool';
import { webFetchTool } from './tools/webFetchTool';
import { webSearchTool } from './tools/webSearchTool';
import { browserControlTool, browserInstallTool } from './tools/browserTool';
import { readImageTool } from './tools/readImageTool';
import { sleepTool, scheduleCronTool } from './tools/scheduleCronTool';
import { aigcOptimizePromptTool } from './tools/genTools';
import { doubaoSpeechGenerateTool } from './tools/doubaoSpeechTool';
import { allProjectTools } from './tools/projectTools';
import { allAppTools } from './tools/appTools';
import { taskStatusTool } from './tools/taskStatusTool';
import { allStoryboardTools } from './tools/storyboardTools';
import { videoGenerateTool } from './tools/videoGenerateTool';
import { imageGenerateTool } from './tools/imageGenerateTool';
import { memoryWriteTool } from './tools/memoryTool';
import { apimartRouteStatusTool } from './tools/apimartRouteTool';

/** 创建包含所有内置工具的默认注册表 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(bashTool);
  registry.register(bashReadOutputTool);
  registry.register(readTool);
  registry.register(writeTool);
  registry.register(editTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(listDirectoryTool);
  // Tier 3 new tools
  registry.register(askUserQuestionTool);
  registry.register(skillInvokeTool);
  registry.register(webFetchTool);
  registry.register(webSearchTool);
  registry.register(browserControlTool);
  registry.register(browserInstallTool);
  registry.register(readImageTool);
  registry.register(sleepTool);
  registry.register(scheduleCronTool);
  registry.register(taskStatusTool);
  registry.register(memoryWriteTool);
  registry.register(videoGenerateTool);
  registry.register(imageGenerateTool);
  registry.register(apimartRouteStatusTool);
  for (const tool of allAppTools) {
    registry.register(tool);
  }
  for (const tool of allCanvasTools) {
    registry.register(tool);
  }
  registry.register(canvasGenerateTool);
  registry.register(canvasGenerateBatchTool);
  registry.register(mgReferenceVideoGenerateTool);
  registry.register(mgTextFallbackGenerateTool);
  registry.register(canvasTranscribeTool);
  registry.register(doubaoSpeechGenerateTool);
  for (const tool of allTimelineTools) {
    registry.register(tool);
  }
  for (const tool of allWorkshopTools) {
    registry.register(tool);
  }
  for (const tool of allStoryboardTools) {
    registry.register(tool);
  }
  for (const tool of allProjectTools) {
    registry.register(tool);
  }
  registry.register(aigcOptimizePromptTool);
  return registry;
}
