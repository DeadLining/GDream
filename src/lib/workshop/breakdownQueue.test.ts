import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyWorkshopData } from './types.ts';
import { breakdownWorkUnits, pendingBreakdownUnits, recordBreakdownWork, splitBreakdownSource, breakdownQueueInstruction } from './breakdownQueue.ts';
import { breakdownCompletionReasons } from './stepStatus.ts';

function seed() {
  const data = emptyWorkshopData('queue');
  data.episodes = [{ no: '02', title: '', sceneList: '', scriptStatus: 'draft', script: '第一段动作。\n'.repeat(400) }];
  data.shots = [{ shotNo: '02-01', episode: '2', description: '已写镜头', characterIds: [] }];
  return data;
}
test('source chunking is lossless and surrogate safe, including very long lines', () => {
  for (const source of ['甲'.repeat(2399) + '😀' + '乙'.repeat(5000), '对白\n'.repeat(5000), '', 'abc']) {
    const chunks = splitBreakdownSource(source);
    assert.equal(chunks.join(''), source);
    assert.ok(chunks.every((chunk) => chunk.length <= 2400));
    assert.ok(chunks.every((chunk) => !/[\uD800-\uDBFF]$/u.test(chunk)));
  }
});
test('one saved shot is not a completed episode; partial batches remain on the same source unit', () => {
  const data = seed(), units = breakdownWorkUnits(data);
  assert.ok(units.length > 1);
  data.breakdownWork = recordBreakdownWork(data, units[0].id, ['02-01'], false);
  assert.equal(pendingBreakdownUnits(data)[0].id, units[0].id);
  data.breakdownWork = recordBreakdownWork(data, units[0].id, ['02-01'], true);
  assert.equal(pendingBreakdownUnits(data)[0].id, units[1].id);
  assert.ok(breakdownCompletionReasons(data).length);
  assert.equal(pendingBreakdownUnits(JSON.parse(JSON.stringify(data)))[0].id, units[1].id);
});
test('revision/script changes and deleted shots invalidate coverage without deleting authored shots', () => {
  const data = seed(), unit = breakdownWorkUnits(data)[0];
  data.breakdownWork = recordBreakdownWork(data, unit.id, ['02-01'], true);
  data.currentScriptRevisionId = 'new';
  assert.throws(() => recordBreakdownWork(data, unit.id, ['02-01'], true), /正文已变化/);
  assert.equal(data.shots.length, 1);
  data.currentScriptRevisionId = undefined;
  data.shots = [];
  assert.equal(pendingBreakdownUnits(data)[0].id, unit.id);
});
test('progress may only reference real shots from the same episode', () => {
  const data = seed(), unit = breakdownWorkUnits(data)[0];
  data.shots.push({ shotNo: '03-01', description: '', characterIds: [] });
  for (const nos of [[], ['missing'], ['03-01']]) assert.throws(() => recordBreakdownWork(data, unit.id, nos, true), /真实镜号/);
});
test('ready source is delivered directly with real IDs and no media dependency', () => {
  const data = seed();
  const prompt = breakdownQueueInstruction(data);
  assert.match(prompt, /<screenplay_source>/);
  assert.match(prompt, /workUnitComplete/);
  assert.match(prompt, /不需要重新读取/);
  assert.doesNotMatch(prompt, /assetImagePath/);
});
test('planned episodes are expanded only after ready episodes; legacy saved episode remains untouched', () => {
  const data = emptyWorkshopData('queue');
  data.episodes = [{ no: '1', title: '', sceneList: '', scriptStatus: 'planned' }, { no: '4', title: '', sceneList: '', scriptStatus: 'planned' }];
  data.shots = [{ shotNo: '01-01', description: '', characterIds: [] }];
  assert.match(breakdownQueueInstruction(data), /第4集尚无正式正文/);
  assert.equal(data.shots.length, 1);
});

test('legacy reconciliation supplies all episode shots, not just its last four, without prompts/media', () => {
  const data = seed();
  data.shots = Array.from({ length: 35 }, (_, i) => ({
    shotNo: `02-${i + 1}`, episode: '2', description: `剧情${i + 1}`, dialogue: `对白${i + 1}`, characterIds: [],
    universalVideoPrompt: 'HUGE_PROMPT'.repeat(10000), videoPath: '/media/secret.mp4',
  }));
  const prompt = breakdownQueueInstruction(data);
  assert.match(prompt, /"shotNo":"02-1"/);
  assert.match(prompt, /"shotNo":"02-35"/);
  assert.match(prompt, /先核对上面已有镜头/);
  assert.doesNotMatch(prompt, /HUGE_PROMPT|secret.mp4|最近已保存内容/);
  assert.ok(prompt.length < 12000);
});

test('large reconciliation uses an explicit compact-state tool, never a truncated list', () => {
  const data = seed();
  data.shots[0].description = '原文动作'.repeat(4000);
  const prompt = breakdownQueueInstruction(data);
  assert.match(prompt, /section:"breakdown-work"/);
  assert.match(prompt, /按 next_call 读完/);
  assert.doesNotMatch(prompt, /section:"prompts"/);
});

test('source dialogue omitted from legacy shots prevents false coverage, not shot saving', () => {
  const data = seed();
  data.episodes[0].script = '朱元璋低声：“我朱启明……穿了？”\n马秀英：“朱元璋，还能走吗？”';
  const unit = breakdownWorkUnits(data)[0];
  assert.throws(() => recordBreakdownWork(data, unit.id, ['02-01'], true), /原文对白尚未登记/);
  data.breakdownWork = recordBreakdownWork(data, unit.id, ['02-01'], false);
  assert.equal(data.shots.length, 1);
  data.shots[0].dialogue = data.episodes[0].script;
  data.breakdownWork = recordBreakdownWork(data, unit.id, ['02-01'], true);
  assert.equal(pendingBreakdownUnits(data).length, 0);
  data.shots[0].dialogue = '';
  assert.equal(pendingBreakdownUnits(data).length, 1);
});
