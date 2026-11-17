import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { describeWithSelectedModel } from './selectedModelVision.ts';
import type { Provider, ChatRequest, ChatOptions } from './providers/types.ts';

function mockProvider(stream?: Provider['streamChat']): Provider {
  return {
    id: 'custom', displayName: '当前自定义接口', baseUrl: 'https://configured.invalid/v1',
    models: [], defaultModelId: 'configured-default', chat: async () => '',
    streamChat: stream ?? (async function* () {
      yield { id: '1', choices: [{ index: 0, delta: { content: '实际图片描述' }, finish_reason: 'stop' }] };
    }),
  };
}
const image = 'data:image/png;base64,aW1hZ2U=';
const context = { languageModel: { providerId: 'custom', modelId: 'user-selected-model' } };

test('vision uses task-selected provider/model and native image, no tools or fallback', async () => {
  const lookups: string[] = [];
  let request: ChatRequest | undefined;
  let options: ChatOptions | undefined;
  let reads = 0;
  const controller = new AbortController();
  const result = await describeWithSelectedModel('/reference.png', '核对外观', context, {
    loadImage: async () => { reads++; return image; },
    getProvider: (id) => {
      lookups.push(id);
      return mockProvider(async function* (req, opts) {
        request = req; options = opts;
        yield { id: '1', choices: [{ index: 0, delta: { reasoning_content: '不应作为结果' }, finish_reason: null }] };
        yield { id: '2', choices: [{ index: 0, delta: { content: '核验结果' }, finish_reason: 'stop' }] };
      });
    },
  }, controller.signal);
  assert.deepEqual(lookups, ['custom']);
  assert.equal(reads, 1);
  assert.equal(request?.modelId, 'user-selected-model');
  assert.equal(request?.requireNativeImages, true);
  assert.equal(request?.tools, undefined);
  assert.equal(options?.signal, controller.signal);
  assert.deepEqual(request?.messages[1], { role: 'user', content: [
    { type: 'text', text: '核对外观' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
  ] });
  assert.equal(result.text, '核验结果');
  assert.equal(result.model, 'user-selected-model');
});

test('missing task context never borrows another workspace or vendor configuration', async () => {
  await assert.rejects(describeWithSelectedModel('/a.png', '?', undefined, {
    loadImage: async () => { assert.fail('must not read'); },
    getProvider: () => { assert.fail('must not resolve a hidden default'); },
  }), /当前任务未传入语言模型配置/);
});

test('provider failure never falls back or exposes raw gateway data', async () => {
  const lookups: string[] = [];
  await assert.rejects(describeWithSelectedModel('/a.png', '?', context, {
    loadImage: async () => image,
    getProvider: (id) => {
      lookups.push(id);
      return mockProvider(async function* () { throw new Error('401 secret-token raw-image-payload'); });
    },
  }), (error: Error) => {
    assert.match(error.message, /user-selected-model.*未切换其他供应商/);
    assert.doesNotMatch(error.message, /secret-token|raw-image-payload/);
    return true;
  });
  assert.deepEqual(lookups, ['custom']);
});

test('unreadable images fail before a model request', async () => {
  await assert.rejects(describeWithSelectedModel('/missing.png', '?', context, {
    loadImage: async () => { throw new Error('missing'); },
    getProvider: () => mockProvider(async function* () { assert.fail('must not call'); }),
  }), /读取参考图失败/);
});

test('empty and truncated answers cannot be reported as completed visual verification', async () => {
  for (const finish of ['stop', 'length']) {
    await assert.rejects(describeWithSelectedModel('/a.png', '?', context, {
      loadImage: async () => image,
      getProvider: () => mockProvider(async function* () {
        yield { id: '1', choices: [{ index: 0, delta: {}, finish_reason: finish }] };
      }),
    }), /未返回有效识图内容|识图回答被截断/);
  }
});

test('cancellation does not start image loading or a provider request', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(describeWithSelectedModel('/a.png', '?', context, {
    loadImage: async () => { assert.fail('must not load'); }, getProvider: () => mockProvider(),
  }, controller.signal), { name: 'AbortError' });
});

test('Harness tool execution pass a task-bound language model', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('./toolRegistry.ts'), /tool.execute\(params, signal, context\)/);
  assert.match(read('./dsh/DshBridge.ts'), /languageModel: \{ providerId: options.providerId\?\.trim\(\) \|\| 'deepseek', modelId: options.model \}/);
  assert.match(read('./dsh/toolRpc.ts'), /registry.execute\(call.name, params, signal, context\)/);
  const tool = read('./tools/visionTool.ts');
  assert.match(tool, /describeWithSelectedModel/);
  assert.doesNotMatch(tool, /visionWithFallback|dmxClient|kimiClient/);
});

test('strict image requests disable Anthropic text-only retry and DeepSeek auto model substitution', () => {
  const glm = readFileSync(new URL('./glmClient.ts', import.meta.url), 'utf8');
  assert.match(glm, /requireNativeImages = requireNativeImages \|\| hasImageBlocks\(messages\)/);
  assert.doesNotMatch(glm, /textOnlyRetry/);
  assert.match(glm, /requireNativeImages \|\| supportsNativeVision/);
  const deepseek = readFileSync(new URL('./providers/deepseek.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(deepseek, /const autoVision|tool-based vision/);
});
