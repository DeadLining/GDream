import type { WorkshopExecutionTask } from '../executionRecovery';
import type { AgentUserContentBlock, CoordinatorCallbacks } from '../types';
import type { ToolRegistry } from '../toolRegistry';

export interface DshStartOptions {
  runId: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /**
   * Owning chat provider. Omitted means DeepSeek (the historical shape);
   * any other id routes the turn through the runtime's generic pi-ai adapter.
   */
  providerId?: string;
  /**
   * pi-ai wire protocol. Required whenever `providerId` is not DeepSeek.
   * See {@link ./providerProtocol.ts}.
   */
  protocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  /** Model id to send on the wire when it differs from `model`. */
  wireModel?: string;
  /** Send `Authorization: Bearer` alongside `x-api-key`. */
  sendBearerAuth?: boolean;
  persona: string;
  workspace: string;
  maxTokens?: number;
  contextWindow?: number;
  httpProxy?: string;
  httpsProxy?: string;
}

export interface DshRunOptions extends DshStartOptions {
  executionTask?: WorkshopExecutionTask;
  input: string;
  mediaBlocks?: AgentUserContentBlock[];
  toolRegistry: ToolRegistry;
  callbacks: CoordinatorCallbacks;
  signal?: AbortSignal;
}

export interface DshRunResult {
  text: string;
  thinking: string;
  visibleOutput: boolean;
  stopReason?: string;
}

export interface DshAcpLineEvent {
  runId: string;
  instanceId: string;
  line: string;
}

export interface DshHarnessEvent {
  runId: string;
  instanceId: string;
  event: Record<string, unknown>;
}

export interface DshToolCallEvent {
  runId: string;
  instanceId: string;
  requestId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface DshToolCancelEvent {
  runId: string;
  instanceId: string;
  requestId: string;
}

export type AcpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource_link'; uri: string; name: string; mimeType?: string };
