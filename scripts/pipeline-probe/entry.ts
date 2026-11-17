export { buildStoryDirectorPrompt, buildEpisodeScreenplayPrompt, STORY_DIRECTOR_CORE_RULES } from '../../src/lib/workshop/storyDirectorPrompt';
export * as prompts from '../../src/lib/workshop/workshopPrompts';
export * as breakdownValidation from '../../src/lib/workshop/breakdownValidation';
export * as breakdownSchema from '../../src/lib/workshop/breakdownSchema';
export { allWorkshopTools } from '../../src/lib/agent/tools/workshopTools';
// 导演级内容检查：探针桩的 set_prompts 回执曾完全缺失这一块（桩保真度缺陷 F18）。
// 与 F17 同理，共用真实实现而不是在桩里近似一遍。
export { collectDirectorPromptWarnings } from '../../src/lib/agent/tools/workshopTools';
export { createDefaultRegistry } from '../../src/lib/agent/toolRegistry';
export * as repeatReadGuard from '../../src/lib/agent/repeatReadGuard';
// 重复写入刹车：探针桩执行器直接用**产品同一份实现**，而不是自己近似一遍。
// 旧版探针用 stableToolParams 近似产品的 JSON.stringify，导致「探针报刹车」
// 不等于「产品会刹车」（缺陷 F17）。现在两边共用 WorkshopWriteGuard。
export {
  WORKSHOP_READ_ONLY_TOOLS,
  WorkshopWriteGuard,
  duplicateWriteNotice,
  isWorkshopMutationTool,
  stableToolParams,
} from '../../src/lib/agent/workshopWriteGuard';
export { isToolEnabled } from '../../src/lib/agent/toolGating';
// 提示词长度预算：**告警阈值与提示词文案的单一事实源**。
// storecheck 的 A9/A10 用真实 tool.execute() 验证「阈值 == 告知模型的区间」，
// 因此这里必须导出产品同一份常量，不能在探针里再抄一遍数字（那正是 F14b 的成因）。
export {
  IMAGE_PROMPT_BUDGET,
  VIDEO_PROMPT_BUDGET,
  budgetLabel,
  planningModeLabel,
  videoBudgetText,
  videoPromptBudget,
} from '../../src/lib/workshop/promptLengthBudget';
export { stripGeneratedVideoBlocks } from '../../src/lib/workshop/shotRefs';
export { buildSystemPrompt, getStaticPrompt } from '../../src/lib/agent/systemPrompt';
export { shouldAutoCompact } from '../../src/lib/agent/autoCompact';
export { useChatStore } from '../../src/stores/chatStore';
export { emptyWorkshopData } from '../../src/lib/workshop/types';
export { useWorkshopStore } from '../../src/stores/workshopStore';
export { useSettingsStore } from '../../src/stores/settingsStore';

export { AgentCoordinator } from '../../src/lib/agent/coordinator';

export { useRunStepStore } from '../../src/stores/runStepStore';

export { DshBridge } from '../../src/lib/agent/dsh/DshBridge';
export { GLMClient } from '../../src/lib/agent/glmClient';
export { buildBreakdownPrompt } from '../../src/lib/workshop/workshopPrompts';

export { breakdownWorkUnits, pendingBreakdownUnits, recordBreakdownWork, breakdownQueueInstruction } from '../../src/lib/workshop/breakdownQueue';

export { useAskUserStore } from '../../src/stores/askUserStore';

export { registerProvider, unregisterProvider } from '../../src/lib/agent/providers/registry';
export { streamWithFallback } from '../../src/lib/agent/providers/router';

export { buildImageRefBindings as adAuditImageRefs, buildVideoRefBindings as adAuditVideoRefs } from '../../src/lib/workshop/shotRefs';
export { buildNativeMediaBlocks } from '../../src/lib/agent/nativeMediaAttachments';
export { executeDshToolCall as pagingAuditDshCall } from '../../src/lib/agent/dsh/toolRpc';

export { readRunArchive, writeRunArchive, flushRunArchive, useRunArchiveStatus } from '../../src/lib/chat/runArchive';
export { savedShotOutcome } from '../../src/lib/chat/runPresentation';

export { writeSessionToFile, readSessionFromFile, deleteSessionFile, compactMessagesForStorage, prepareAgentMessagesForDisk } from "../../src/lib/historyPersistence";

export { useProjectStore } from '../../src/stores/projectStore';
export { useCanvasStore } from '../../src/stores/canvasStore';

export { useUnifiedProjectStore } from '../../src/stores/unifiedProjectStore';
export { useCanvasTaskStore } from '../../src/stores/canvasTaskStore';
export { runWorkshopContinuation, sendScopedWorkshopMessage } from '../../src/lib/workshop/continuationRuntime';

export { syncWorkshopLineageToCanvas } from "../../src/lib/workshop/canvasSync";
export { quickChat } from '../../src/lib/agent/quickChat';
