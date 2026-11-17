/** Offline failure injection into real coordinator, ACP bridge, tools and stream parser.
 * No external APIs, no user project IO and no paid generation.
 */
import assert from 'node:assert/strict';
import { installShims } from './preload.mjs';
installShims();
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const h = await import('./.gen/harness.mjs');
h.useChatStore.setState({ activeView: 'workshop' });
const input = `[工坊上下文：项目「测试」，当前步骤 breakdown。按需先调用 workshop_get_state 读取必要状态；修改工坊请使用 workshop_* 工具并确保 UI 实时联动。]\n\n${h.buildBreakdownPrompt()}`;
let commits = 0;
function seed() {
  const data = h.emptyWorkshopData('recovery-test');
  data.currentStep = 'breakdown';
  data.episodes = [{ no: '1', title: '', sceneList: '', scriptStatus: 'draft', script: '已有剧本' }, { no: '2', title: '', sceneList: '', scriptStatus: 'draft', script: '第二集剧本' }];
  data.shots = [{ id: 'shot-1', shotNo: '01-01', episode: '1', description: '原镜头', characterIds: [], voiceCharacterIds: [], productReferenceImages: [], sourceScriptRevisionId: undefined }];
  data.breakdownWork = h.recordBreakdownWork(data, h.breakdownWorkUnits(data)[0].id, ['01-01'], true);
  commits = 0;
  h.useWorkshopStore.setState({ project: { id: data.projectId, name: '测试', sources: [] }, data, scheduleSave() {}, async commitNow() { commits++; } });
  h.useRunStepStore.getState().startRun({ sessionId: 'offline', userRequest: input });
  return structuredClone(data.shots);
}
const text = (value = '', finishReason = 'stop') => ({ text: value, reasoningText: '', thinkingBlocks: [], finishReason, toolCalls: [] });
let seq = 0;
const call = (name, params) => ({ ...text(), finishReason: 'tool_calls', toolCalls: [{ id: `call-${++seq}`, type: 'function', function: { name, arguments: JSON.stringify(params) } }] });
const saveShot = () => call('workshop_set_shots', { mode: 'merge', workUnitId: h.pendingBreakdownUnits(h.useWorkshopStore.getState().data)[0].id, workUnitComplete: true, shots: [{ shotNo: '02-01', episode: '2', description: '第二集镜头', characterIds: [] }] });
const done = () => call('workshop_set_step_status', { step: 'breakdown', status: 'done' });
const stateRead = () => call('workshop_get_state', { detail: 'step', section: 'breakdown' });
const noopCallbacks = () => ({ onTextDelta() {}, onThinkingDelta() {}, onToolStart() {}, onToolEnd() {}, onComplete() {}, onError() {} });

// Drive the actual DshBridge, with only transport/lifecycle substituted.
async function harness(responses, request = input, control = {}) {
  let count = 0, started = 0, disposed = 0, toolResult, dispatch, execute;
  const prompts = [];
  const registry = h.createDefaultRegistry();
  const bridge = new h.DshBridge({
    createTools(_run, _instance, _registry, _callbacks, onDispatch, _context, onResult) {
      dispatch = onDispatch; toolResult = onResult;
      execute = async (name, params) => {
        dispatch(name);
        const result = await registry.execute(name, params);
        toolResult(name, params, result);
        return result;
      };
      return { async start() {}, abort() {}, dispose() {} };
    },
    createAcp(_options, _instance, onUpdate) {
      return {
        async start() { started++; }, async cancel() {}, async dispose() { disposed++; },
        async prompt(prompt, media) {
          prompts.push({ prompt, media });
          const response = responses[count++];
          assert.ok(response, 'unexpected extra ACP request');
          if (control.beforeResponse) await control.beforeResponse(count, bridge);
          for (const tc of response.toolCalls) {
            onUpdate({ sessionId: 'offline', update: { sessionUpdate: 'tool_call' } });
            const name = tc.function.name, params = JSON.parse(tc.function.arguments);
            if (name === 'fake_paid_generate') { dispatch(name); toolResult(name, params, { success: true, output: 'submitted once' }); }
            else { const result = await execute(name, params); if (!control.allowToolFailures) assert.equal(result.success, true, result.error); }
          }
          if (response.text) onUpdate({ sessionId: 'offline', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: response.text } } });
          return { stopReason: response.finishReason };
        },
      };
    },
  });
  let result, error;
  try { result = await bridge.run({ runId: 'offline', apiKey: '', baseUrl: 'http://unused', model: 'deepseek-v4-flash', persona: '', workspace: '/offline', input: request, toolRegistry: registry, callbacks: noopCallbacks() }); }
  catch (value) { error = value; }
  return { count, final: result?.text ?? '', error, started, disposed, prompts, bridge };
}

for (const [name, run] of [['harness', harness]]) {
  let original = seed();
  let result = await run([text('本轮尚未调用工坊工具'), saveShot(), done(), text()]);
  assert.equal(result.error, undefined);
  assert.match(result.final, /完成状态的工具回执/);
  assert.equal(h.useWorkshopStore.getState().data.shots.length, 2);
  assert.deepEqual(h.useWorkshopStore.getState().data.shots[0], original[0]);
  assert.ok(commits >= 2);
  console.log(`PASS ${name}: real UI prefix, zero-tool final recovered, saved receipts produce final even when prose empty`);

  seed();
  result = await run([text(), text('本轮尚未调用工具')]);
  assert.equal(result.error?.name, 'ExecutionStoppedError');
  assert.equal(result.count, 2);
  assert.equal(result.final, '');
  assert.equal(commits, 0);
  console.log(`PASS ${name}: repeated no-progress response is failure, never successful completion`);

  seed();
  result = await run([text('', 'length'), saveShot(), done(), text('已保存')]);
  assert.equal(result.error, undefined);
  assert.match(result.final, /完成状态的工具回执/);
  console.log(`PASS ${name}: thinking-only length stop recovers toward execution`);
}

// Generic response recovery must reset after a tool result (not accumulate empties across the run).
seed();
let result = await harness([text(), stateRead(), text(), text('已读取')], '查看工坊状态');
assert.equal(result.error, undefined);
assert.equal(result.count, 4);
assert.equal(result.final, '已读取');
console.log('PASS harness: nonconsecutive empty replies each get a recovery opportunity');

seed();
result = await harness([call('fake_paid_generate', {})]);
assert.equal(result.error?.name, 'ExecutionStoppedError');
assert.equal(result.count, 1);
assert.equal(result.started, 1);
assert.equal(result.disposed, 1);
console.log('PASS harness: paid dispatch stops automated continuation and is never replayed');

seed();
result = await harness([text('准备继续'), text('已按新要求停止拆解')], input, { beforeResponse: (n, bridge) => { if (n === 1) bridge.queueGuidance('停止拆解，只解释 Beat'); } });
assert.equal(result.error, undefined);
assert.equal(result.count, 2);
assert.equal(result.final, '已按新要求停止拆解');
assert.equal(commits, 0);
console.log('PASS harness: user guidance supersedes execution goal without restarting ACP');

seed();
result = await harness([text('准备继续')], input, { beforeResponse: async (_n, bridge) => { await bridge.abort(); } });
assert.equal(result.error?.name, 'AbortError');
assert.equal(result.count, 1);
console.log('PASS harness: abort wins over automatic continuation');

// Actual GLMClient stream: deliver all chunks and terminal event before invoke resolves.
// Only the Tauri IPC boundary is mocked. The old while(!isDone) dropped this queued tail.
window.crypto = globalThis.crypto;
const listeners = new Map();
let listenerId = 0;
const modes = ['tail', 'error'];
window.__TAURI_IPC__ = (args) => {
  const resolve = (value) => window[`_${args.callback}`]?.(value);
  if (args.__tauriModule === 'Event') {
    if (args.message.cmd === 'listen') { const id = ++listenerId; listeners.set(id, args.message); resolve(id); }
    else { listeners.delete(args.message.eventId); resolve(); }
    return;
  }
  if (args.cmd === 'stream_http_request') {
    const mode = modes.shift();
    const emit = (event, payload) => {
      for (const [id, listener] of listeners) if (listener.event === event) window[`_${listener.handler}`]?.({ event, id, payload });
    };
    if (mode === 'tail') {
      const events = [
        { type: 'message_start', message: { id: 'm', usage: { input_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '队列末尾正文' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ];
      for (const event of events) emit(`stream-chunk-${args.requestId}`, { chunk: `data: ${JSON.stringify(event)}\n\n` });
      emit(`stream-done-${args.requestId}`, {});
    } else emit(`stream-error-${args.requestId}`, { status: 503, message: 'offline simulated failure' });
    resolve(); return;
  }
  resolve();
};
const client = new h.GLMClient({ apiKey: '', baseUrl: 'http://offline', model: 'offline' });
const chunks = [];
for await (const chunk of client.streamChat([{ role: 'user', content: '测试' }])) chunks.push(chunk);
assert.equal(chunks.map((chunk) => chunk.choices?.[0]?.delta?.content ?? '').join(''), '队列末尾正文');
assert.ok(chunks.some((chunk) => chunk.choices?.[0]?.finish_reason === 'end_turn'));
await assert.rejects(async () => { for await (const _ of client.streamChat([{ role: 'user', content: '测试' }])) {} }, /503/);
console.log('PASS real GLM stream: queued tail and queued transport error are consumed before terminal exit');

for (const [engine, runner] of [['harness', harness]]) {
  seed();
  const data = h.useWorkshopStore.getState().data;
  const dialogue = '朱元璋：“退车，先保人！其余照操练来！”\n朱元璋：“不伤降者。”\n李善长：“元廷已退出中原。粮还得送到。”\n朱元璋：“禁扰百姓，清点仓粮，先救断粮户！”';
  data.episodes[1].script = dialogue;
  data.shots.push({ shotNo: '02-01', episode: '2', description: '对应剧情', characterIds: [] });
  const unit = h.pendingBreakdownUnits(data)[0];
  const completion = () => call('workshop_complete_breakdown_unit', { workUnitId: unit.id, shotNos: ['02-01'] });
  const failedTurn = completion();
  failedTurn.text = '本段尚未登记，未修改';
  const result = await runner([
    text('先核对现有镜头'), failedTurn,
    call('workshop_restore_shot_dialogue', { shotNo: '02-01', dialogue }),
    completion(), done(), text(),
  ], input, { allowToolFailures: true });
  assert.equal(result.error, undefined, result.error?.stack);
  assert.match(result.final, /完成状态的工具回执/);
  assert.equal(h.useWorkshopStore.getState().data.shots.length, 2);
  assert.equal(h.useWorkshopStore.getState().data.shots[1].dialogue, dialogue);
  console.log(`PASS ${engine}: no-write continuation -> dialogue completion failure -> directed repair -> saved completion`);
}
