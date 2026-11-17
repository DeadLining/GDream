/**
 * 对话界面「哪些角色该显示、以什么版式显示」的单一事实源。
 *
 * 背景（2026-09-17 复查）：三条用户可见的提示被写成 `role: 'system'`——
 *   - 渠道降级说明（useAgent：所选渠道缺 key，本次改跑别的渠道）
 *   - 一键全流程失败门控（WorkshopChatPanel：本步失败，后续步骤已取消）
 *   - 斜杠命令输出 / 系统修复提示
 * 但 `AgentDrawer` 只渲染 `user | assistant`，于是工坊、画布、剪辑、文案、导演台
 * **五个抽屉全都不显示这些提示**——用户看到的仍然是「什么都没发生」。
 *
 * 为什么不能简单地把它们改成 `assistant`：`system` 是本仓库**刻意**用来表达
 * 「持久保存、用户可见、但不进入模型上下文」的角色，
 * `projectMessages.ts:projectUIMessagesToAgentMessages()` 明确跳过它。
 * 改成 assistant 会让这些提示被回灌给模型，污染后续轮次的上下文。
 *
 * 所以正确的修法是**统一显示策略**：界面可见 = user | assistant | system，
 * 三者只是版式不同（气泡 / 助手正文 / 系统提示条）。
 *
 * 注意本模块**只按角色过滤**，不按内容过滤：空正文但带产物的消息
 * （例如只挂 ArtifactGrid 的助手消息）必须保持可见，否则会连带影响产物展示。
 *
 * 本模块不 import 任何 `@/` 运行期依赖，`node --test` 可直接加载。
 */
import type { Message } from '@/types';

/** 界面需要渲染的角色。**不是**发送给模型的白名单（那是 projectMessages 的职责）。 */
export const SURFACE_VISIBLE_ROLES = ['user', 'assistant', 'system'] as const;

export type SurfaceRole = (typeof SURFACE_VISIBLE_ROLES)[number];

/** 版式类别：用户气泡 / 助手正文 / 系统提示条。 */
export type SurfaceMessageKind = 'user' | 'assistant' | 'notice';

export function isSurfaceVisible(role: Message['role'] | string): boolean {
  return (SURFACE_VISIBLE_ROLES as readonly string[]).includes(role);
}

/** 界面版式分类。未知角色按系统提示条处理：宁可显示，也不要静默吞掉。 */
export function surfaceMessageKind(role: Message['role'] | string): SurfaceMessageKind {
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';
  return 'notice';
}

/**
 * 界面对话流。仅按角色过滤——**不**丢弃空正文消息，
 * 因为产物卡片可以挂在没有正文的助手消息上。
 */
export function surfaceMessages(messages: readonly Message[]): Message[] {
  return messages.filter((message) => isSurfaceVisible(message.role));
}
