import assert from 'node:assert/strict';
import test from 'node:test';
import { frameGroundedChat } from './frameGroundedChat.ts';
import type { Provider, ChatRequest } from './providers/types.ts';
const image = 'data:image/png;base64,aW1hZ2U=';
const messages = [{ role: 'system', content: 'H3 rules' }, { role: 'user', content: 'Actual script and speakers' }];
function provider(stream: Provider['streamChat']): Provider {
  return { id: 'custom', displayName: 'Selected', baseUrl: '', models: [], defaultModelId: 'default', chat: async () => '', streamChat: stream };
}
test('rewriter sends real image and script in one native-image call to selected model', async () => {
  let request: ChatRequest | undefined;
  const out = await frameGroundedChat(messages, '/actual-tail.png', { providerId: 'custom', modelId: 'chosen' }, {
    loadImage: async (path) => { assert.equal(path, '/actual-tail.png'); return image; },
    getProvider: (id) => { assert.equal(id, 'custom'); return provider(async function* (req) {
      request = req;
      yield { id: '1', choices: [{ index: 0, delta: { content: 'prompt' }, finish_reason: 'stop' }] };
    }); },
  });
  assert.equal(out, 'prompt');
  assert.equal(request?.requireNativeImages, true);
  assert.equal(request?.modelId, 'chosen');
  assert.deepEqual(request?.messages[1].content, [
    { type: 'text', text: messages[1].content },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
  ]);
});
test('missing file prevents model call', async () => {
  await assert.rejects(frameGroundedChat(messages, '/missing.png', { providerId: 'custom' }, {
    loadImage: async () => { throw new Error('missing'); },
    getProvider: () => provider(async function* () { assert.fail('must not submit'); }),
  }), /读取失败/);
});
for (const mode of ['failure', 'empty', 'length']) test(`image ${mode} cannot downgrade to text or return partial prompt`, async () => {
  let calls = 0;
  await assert.rejects(frameGroundedChat(messages, '/frame.png', { providerId: 'custom' }, {
    loadImage: async () => image,
    getProvider: () => provider(async function* () {
      calls++;
      if (mode === 'failure') throw new Error('secret upstream body');
      yield { id: '1', choices: [{ index: 0, delta: { content: mode === 'empty' ? '' : 'partial' }, finish_reason: mode === 'length' ? 'length' : 'stop' }] };
    }),
  }), (error: Error) => { assert.match(error.message, /未降级为纯文字/); assert.doesNotMatch(error.message, /secret/); return true; });
  assert.equal(calls, 1);
});
