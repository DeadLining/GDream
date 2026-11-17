import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdShotContinuityContext, AD_CONTINUITY_RULES } from './adContinuity.ts';
import { buildShotRewriteFacts } from './shotRewriteContext.ts';
import { buildProductAdPrompt } from './adSpec.ts';
import { buildAdTaskContext } from './adTaskPrompt.ts';
import type { WorkshopData, WsShot } from './types.ts';

const shot = (shotNo: string, episode = '01'): WsShot => ({
  id: shotNo, shotNo, episode, sceneId: 'office', description: `画面-${shotNo}`,
  characterIds: [], propIds: ['station'], entryState: { location: 'office', time: 'day', characters: '无人', environment: '柔光', props: '同一份资料' },
  exitState: { location: 'office', time: 'day', characters: '无人', environment: '柔光', props: '该资料的要点' },
} as WsShot);
const shots = [shot('01-01'), shot('01-02'), shot('01-03')];
const data = { projectId: 'p', creativeSpec: { workKind: 'product-ad', adSpec: { productName: 'Station' } },
  shots, episodes: [], characters: [], scenes: [], props: [], synopsis: '同一业务过程',
} as unknown as WorkshopData;

test('广告重写包含真实前后镜事实，但不注入候选路径或跨镜生成指令', () => {
  const text = buildShotRewriteFacts(data, shots[1]);
  assert.match(text, /ADJACENT_SHOT_CONTEXT/);
  assert.match(text, /画面-01-01/);
  assert.match(text, /画面-01-03/);
  assert.match(text, /只重写当前镜/);
  assert.doesNotMatch(text, /videoCandidates/);
});
test('首尾镜只含同集相邻项，不按字符串重新排列镜头', () => {
  const context = buildAdShotContinuityContext({ ...data, shots: [shots[0], shots[1], shot('02-01', '02')] }, shots[1]);
  assert.match(context, /"next":null/);
  assert.match(buildAdShotContinuityContext(data, shots[0]), /"previous":null/);
});
test('非广告及缺少当前镜不猜测邻接关系', () => {
  assert.equal(buildAdShotContinuityContext({ ...data, creativeSpec: undefined }, shots[1]), '');
  assert.match(buildAdShotContinuityContext({ ...data, shots: [] }, shots[1]), /未取得/);
});
test('旧的空转场保留为缺口，不自动补造桥接事实', () => {
  const current = { ...shots[1], transitionPlan: { kind: 'dissolve', trigger: '', target: '', prompt: '' } } as WsShot;
  const text = buildAdShotContinuityContext({ ...data, shots: [shots[0], current] }, current);
  assert.match(text, /"trigger":""/);
  assert.match(text, /不代表已完成衔接设计/);
});
test('广告创建与继续任务均携带整片连续性纪律', () => {
  const prompt = buildProductAdPrompt('brief', { productName: 'Station', productCategory: 'physical', audience: ['partner'], objective: 'awareness', durationSec: 60 });
  assert.ok(prompt.includes(AD_CONTINUITY_RULES));
  assert.match(prompt, /transitionPlan 仅表示单条生成视频内部/);
  assert.match(prompt, /bibles.continuity.blockingContinuity/);
  assert.ok(buildAdTaskContext(data, '继续').includes(AD_CONTINUITY_RULES));
  assert.equal(buildAdTaskContext({ ...data, creativeSpec: undefined }, '继续'), '');
});

test('已有创作请求不重复注入规则，首镜不会继承上一集结尾', () => {
  assert.ok(!buildAdTaskContext(data, AD_CONTINUITY_RULES).includes(AD_CONTINUITY_RULES));
  const priorEpisode = shot('00-09', '00');
  assert.match(buildAdShotContinuityContext({ ...data, shots: [priorEpisode, ...shots] }, shots[0]), /"previous":null/);
});

test('构建提示词只读数据，不修改已有分镜或候选', () => {
  const before = JSON.stringify(data);
  buildShotRewriteFacts(data, shots[1]);
  assert.equal(JSON.stringify(data), before);
});
