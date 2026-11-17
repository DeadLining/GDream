import { DeepSeekProvider, type DeepSeekConfig } from './deepseek';
import { normalizeCustomOpenAIBaseUrl } from './customOpenAIUrl';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import type { ChatOptions, CompletionResult, SimpleCompletionRequest } from './types';

interface OpenAIChatChoice {
  message?: {
    content?: string | null;
    reasoning_content?: string | null;
    reasoning?: string | null;
  };
  text?: string | null;
  finish_reason?: string | null;
}

function extractOpenAIText(choice: OpenAIChatChoice | undefined): string {
  return choice?.message?.content
    || choice?.message?.reasoning_content
    || choice?.message?.reasoning
    || choice?.text
    || '';
}

export class CustomOpenAIProvider extends DeepSeekProvider {
  readonly id = 'custom';
  readonly displayName = '自定义 OpenAI 兼容接口';

  constructor(cfg: DeepSeekConfig) {
    super({
      ...cfg,
      baseUrl: normalizeCustomOpenAIBaseUrl(cfg.baseUrl),
      modelId: cfg.modelId || 'local-model',
    });
  }

  async healthCheck(): Promise<boolean> {
    if (!this.baseUrl || !this.cfg.apiKey) return false;
    try {
      const response = await tauriFetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        responseType: ResponseType.JSON,
        timeout: 15,
      });
      if (response.status === 401 || response.status === 403) return false;
      return true;
    } catch {
      return false;
    }
  }

  async chatDetailed(req: SimpleCompletionRequest, _opts: ChatOptions): Promise<CompletionResult> {
    const body = {
      model: req.modelId ?? this.defaultModelId,
      messages: req.messages,
      max_tokens: req.maxTokens ?? 2000,
      stream: false,
    };
    const response = await tauriFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: { type: 'Json', payload: body },
      responseType: ResponseType.JSON,
      timeout: 120,
    });
    if (response.status < 200 || response.status >= 300) {
      const payload = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      const error = new Error(`Custom OpenAI ${response.status}: ${payload.slice(0, 500)}`) as Error & { status: number };
      error.status = response.status;
      throw error;
    }
    const data = response.data as {
      choices?: OpenAIChatChoice[];
    };
    const choice = data.choices?.[0];
    return {
      text: extractOpenAIText(choice),
      finishReason: choice?.finish_reason ?? null,
    };
  }
}
