import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyWorkshopData } from './types.ts';
import { isEpisodeScriptRequest, resolveEpisodeScriptTask, episodeScriptProgress, buildEpisodeScriptTaskContext, episodeScriptStopNotice } from './episodeScriptTask.ts';
import { buildEpisodeScriptState } from './episodeScriptState.ts';
import { resolveWorkshopRunBudget } from '../agent/workshopRunBudget.ts';

function fixture() {
  const data = emptyWorkshopData('p');
  data.episodes = Array.from({ length: 5 }, (_, i) => ({ no: String(i + 1), title: `标题${i + 1}`, sceneList: '场景', scriptStatus: 'planned' as const }));
  data.episodes[0] = { ...data.episodes[0], script: '已有第一集正文', scriptStatus: 'draft' } as typeof data.episodes[number];
  data.narrativeBeats = [
    { id: 'beat-2', episode: '2', sceneId: 's2', title: '目标集', purpose: '推进' },
    { id: 'beat-4', episode: '4', sceneId: 's4', title: '无关集', purpose: '推进' },
  ];
  data.scenes = [{ id: 's2', name: '房间', description: '房间事实' }, { id: 's4', name: '室外', description: '室外事实' }];
  return data;
}

const request = '先补写第2至5集的完整剧本和对白';

test('the exact reported request is a four-episode script task, not generic chat', () => {
  const data = fixture();
  const task = resolveEpisodeScriptTask(request, data)!;
  assert.deepEqual(task.targetEpisodeNos, ['2', '3', '4', '5']);
  const budget = resolveWorkshopRunBudget({ userInput: request, defaultMaxTurns: 30, episodeScriptCount: task.targetEpisodeNos.length, sourceChars: 28000 });
  assert.equal(budget.kind, 'episode-script');
  assert.equal(budget.maxTurns, 52);
  assert.equal(data.episodes[0].script, '已有第一集正文');
});

test('ranges, Chinese numbers, padded IDs and explicit lists preserve exact targets', () => {
  for (const text of ['补写第二至五集的完整剧本', '生成第2集到第5集的剧本', '补全第2-5集剧本']) {
    assert.deepEqual(resolveEpisodeScriptTask(text, fixture())?.targetEpisodeNos, ['2', '3', '4', '5']);
  }
  assert.deepEqual(resolveEpisodeScriptTask('补写第2、4集的剧本', fixture())?.targetEpisodeNos, ['2', '4']);
  const data = fixture();
  data.episodes[1].no = '02';
  assert.deepEqual(resolveEpisodeScriptTask('补写第2集剧本', data)?.targetEpisodeNos, ['02']);
  assert.deepEqual(resolveEpisodeScriptTask('补写第8集剧本', data)?.missingEpisodeNos, ['8']);
  assert.deepEqual(resolveEpisodeScriptTask('补写第8集剧本', data)?.targetEpisodeNos, []);
});

test('saved episode checkpoints survive a new request and only unfinished episodes are selected', () => {
  const data = fixture();
  const task = resolveEpisodeScriptTask(request, data)!;
  data.episodes[1] = { ...data.episodes[1], script: '第2集完整稿', scriptStatus: 'draft' };
  data.episodes[2] = { ...data.episodes[2], script: '第3集完整稿', scriptStatus: 'frozen' };
  assert.deepEqual(episodeScriptProgress(task, data).saved, ['2', '3']);
  const resumed = resolveEpisodeScriptTask(request, data)!;
  assert.deepEqual(resumed.targetEpisodeNos, ['4', '5']);
  assert.deepEqual(resumed.protectedEpisodeNos, ['2', '3']);
  assert.match(buildEpisodeScriptTaskContext(task, data), /待保存：4、5/);
  assert.match(buildEpisodeScriptTaskContext(task, data), /按每个 Scene 的戏剧功能、自然语速/);
  assert.match(buildEpisodeScriptTaskContext(task, data), /用户时长默认是参考/);
  assert.match(buildEpisodeScriptTaskContext(task, data), /不能只写一两句关键台词/);
  assert.match(buildEpisodeScriptTaskContext(task, data), /继续扩写或重排后再保存/);
  assert.match(episodeScriptStopNotice(task, data, 52, new Set(['2'])), /已保存的目标集：2。/);
  assert.match(episodeScriptStopNotice(task, data, 52, new Set(['2'])), /仍待保存：3、4、5/);
});

test('rewrite requires a changed script and switching projects never claims completion', () => {
  const data = fixture();
  const task = resolveEpisodeScriptTask('重新生成第1集的剧本', data)!;
  assert.deepEqual(task.targetEpisodeNos, ['1']);
  assert.deepEqual(episodeScriptProgress(task, data).saved, []);
  data.episodes[0].script = '新剧本';
  assert.deepEqual(episodeScriptProgress(task, data).saved, ['1']);
  const other = { ...data, projectId: 'other' };
  assert.equal(episodeScriptProgress(task, other).sameProject, false);
  assert.deepEqual(episodeScriptProgress(task, other).saved, []);
});

test('explanatory questions and shot prompt requests do not become script-writing tasks', () => {
  for (const text of ['为什么补写第2集剧本总失败', '如何生成第2集剧本', '重写第2集视频提示词', '为什么 workshop_set_episode_script 用不了', '帮我看看工坊里这个分镜为什么审核不通过']) {
    assert.equal(isEpisodeScriptRequest(text), false, text);
  }
});

test('episode button target wins over episode numbers quoted in source prose', () => {
  const prompt = '[episode-screenwriter 逐集剧本技能]\n请只为第2集写完整详细剧本。\n故事在第4集结束。\n必须调用 workshop_set_episode_script 保存到 episode_no="2"';
  assert.deepEqual(resolveEpisodeScriptTask(prompt, fixture())?.targetEpisodeNos, ['2']);
});

test('episode state separates shared source facts from per-episode bodies and production payloads', () => {
  const data = fixture();
  data.characters = [{ id: 'c', name: '角色', personality: '开朗', appearance: '短发', assetImagePath: 'private-image' }];
  const shared = buildEpisodeScriptState(data);
  const local = buildEpisodeScriptState(data, '2');
  assert.ok('episodes' in shared);
  assert.equal(JSON.stringify(shared).includes('已有第一集正文'), false);
  assert.equal(JSON.stringify(shared).includes('private-image'), false);
  assert.ok('episode' in local);
  assert.equal(local.episode?.no, '2');
  assert.equal(local.previousEpisode?.script, '已有第一集正文');
  assert.deepEqual(local.narrativeBeats?.map((beat) => beat.id), ['beat-2']);
  assert.deepEqual(local.scenes.map((scene) => scene.id), ['s2']);
  assert.equal('shots' in local, false);
  assert.equal('currentScriptRevision' in local, false);
  assert.throws(() => buildEpisodeScriptState(data, '99'), /未找到/);
});

test('script run budgets scale with episode and source-read workload but remain bounded', () => {
  const small = resolveWorkshopRunBudget({ userInput: request, defaultMaxTurns: 30, episodeScriptCount: 1, sourceChars: 16000 });
  const large = resolveWorkshopRunBudget({ userInput: request, defaultMaxTurns: 30, episodeScriptCount: 40, sourceChars: 1000000 });
  assert.equal(small.maxTurns, 30);
  assert.equal(large.maxTurns, 96);
});

test('runtime uses persistent progress guidance and receipts, not just a larger turn limit', () => {
  const coordinator = readFileSync(new URL('../agent/dsh/DshBridge.ts', import.meta.url), 'utf8');
  assert.match(coordinator, /buildEpisodeScriptTaskContext\(episodeScriptTask/);
  assert.match(coordinator, /episodeScriptReceipts\.add\(no\)/);
  assert.match(coordinator, /every\(\(no\) => episodeScriptReceipts\.has\(no\)\)/);
  assert.match(coordinator, /beforeExecute:/);
  const tools = readFileSync(new URL('../agent/tools/workshopTools.ts', import.meta.url), 'utf8');
  assert.match(tools, /buildEpisodeScriptState\(s.data, episodeNo\)/);
  assert.match(tools, /不要切换为分镜拆解/);
  assert.doesNotMatch(tools, /详细剧本已保存.*可进入本集分镜拆解/);
});
