import { adMaterialsFingerprint } from './adMaterials.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from './types.ts';
import { buildContinueAutoRunPrompt, nextContinuationStage, runContinuation, assertContinuationOwner } from './continueAutoRun.ts';
import type { ContinuationSnapshot } from './continueAutoRun.ts';

function fixture() {
  const data = emptyWorkshopData('p');
  data.shots = [{shotNo:'01-01',description:'测试',characterIds:[],durationSec:5}];
  const state: ContinuationSnapshot = {projectId:'p',unifiedId:'p',data,tasks:[]};
  return state;
}
const owner = {projectId:'p',unifiedId:'p'};

test('done labels cannot bypass missing saved outputs; only existing products are skipped', () => {
  const s = fixture();
  for (const step of Object.values(s.data!.steps)) step.status = 'done';
  s.data!.shots = [];
  assert.equal(nextContinuationStage(s.data!), 'breakdown');
  s.data = fixture().data;
  assert.equal(nextContinuationStage(s.data!), 'prompts');
  s.data!.shots[0].imagePrompt = '画面';
  s.data!.shots[0].videoPrompt = '动作';
  assert.equal(nextContinuationStage(s.data!), 'generate');
});
test('asset prompts are not asset approval and stale prompt slots are incomplete', () => {
  const s = fixture();
  s.data!.characters = [{id:'c',name:'产品',appearance:'',personality:''}];
  assert.equal(nextContinuationStage(s.data!), 'asset-prompts');
  s.data!.characters[0].assetPrompt = '外观';
  assert.equal(nextContinuationStage(s.data!), 'assets');
  s.data!.characters = [];
  s.data!.shots[0].imagePrompt = '图'; s.data!.shots[0].videoPrompt = '视频';
  s.data!.shots[0].promptNeedsRefresh = true;
  assert.equal(nextContinuationStage(s.data!), 'prompts');
});
test('each request is scoped to one stage, uses original template, and never marks the whole run breakdown', () => {
  const s = fixture();
  const prompt = buildContinueAutoRunPrompt('prompts', s.data!, '', {hasSourceFiles:true});
  assert.match(prompt, /本轮只执行/);
  assert.match(prompt, /workshop_set_prompts/);
  assert.doesNotMatch(prompt, /\[工坊任务:breakdown\]/);
  const paid = buildContinueAutoRunPrompt('generate', s.data!, '', {hasSourceFiles:true});
  for (const text of ['ask_user_question','不得重复提交','结果未知','任务 ID','后台']) assert.ok(paid.includes(text), text);
});
test('owner checks reject both project and unified canvas changes', () => {
  assert.doesNotThrow(() => assertContinuationOwner(owner, fixture()));
  assert.throws(() => assertContinuationOwner(owner, {...fixture(),projectId:'other'}));
  assert.throws(() => assertContinuationOwner(owner, {...fixture(),unifiedId:'other'}));
});
test('continuation executes the evidence-selected stage rather than replaying assets', async () => {
  const s = fixture(); const sent: string[] = [];
  const result = await runContinuation(owner, { snapshot: () => s, saveAndRead: async () => s.data!, execute: async stage => { sent.push(stage); return { error: 'blocked' }; } });
  assert.deepEqual(sent, ['prompts']);
  assert.equal(result.status, 'paused');
});

test('a successful model response without saved outputs stops rather than advancing', async () => {
  const s = fixture(); const sent: string[] = [];
  const result = await runContinuation(owner, {snapshot:()=>s,saveAndRead:async()=>s.data!,execute:async stage=>{sent.push(stage);return {};}});
  assert.deepEqual(sent,['prompts']); assert.equal(result.status,'paused');
});
test('persisted progress advances once; a queued paid job pauses without replay', async () => {
  const s = fixture(); const sent: string[] = [];
  const result = await runContinuation(owner, {snapshot:()=>s,saveAndRead:async()=>structuredClone(s.data!),execute:async stage=>{
    sent.push(stage);
    if(stage==='prompts') {s.data!.shots[0].imagePrompt='image';s.data!.shots[0].videoPrompt='video';}
    else s.tasks=[{id:'t',projectId:'p',status:'running'}];
    return {};
  }});
  assert.deepEqual(sent,['prompts','generate']); assert.equal(result.status,'paused');
  const retry = await runContinuation(owner, {snapshot:()=>s,saveAndRead:async()=>s.data!,execute:async()=>{assert.fail('must not submit again');}});
  assert.equal(retry.status,'paused');
});
test('confirmation, uncertain submission and failed paid attempts block a new run', async () => {
  for (const patch of [{waitingForConfirmation:true}, {tasks:[{id:'x',projectId:'p',status:'failed',submissionUncertain:true}]}, {tasks:[{id:'x',projectId:'p',status:'failed'}]}]) {
    const s = {...fixture(),...patch};
    const result = await runContinuation(owner, {snapshot:()=>s,saveAndRead:async()=>s.data!,execute:async()=>{assert.fail('must not dispatch');}});
    assert.equal(result.status,'paused');
  }
});
test('project switch during disk read, aborted turn and disk failure cannot advance', async () => {
  const s = fixture();
  await assert.rejects(runContinuation(owner,{snapshot:()=>s,saveAndRead:async()=>{s.unifiedId='other';return s.data!;},execute:async()=>{assert.fail('wrong project');}}));
  const s2 = fixture();
  const aborted = await runContinuation(owner,{snapshot:()=>s2,saveAndRead:async()=>s2.data!,execute:async()=>({error:'用户取消'})});
  assert.equal(aborted.status,'paused');
  await assert.rejects(runContinuation(owner,{snapshot:()=>fixture(),saveAndRead:async()=>{throw new Error('disk full');},execute:async()=>{assert.fail('not saved');}}),/disk full/);
});
test('state regression after a stage stops, it does not restart completed work', async () => {
  const s = fixture();const sent: string[]=[];
  const result=await runContinuation(owner,{snapshot:()=>s,saveAndRead:async()=>s.data!,execute:async stage=>{sent.push(stage);s.data!.shots=[];return {};}});
  assert.equal(result.status,'paused');assert.deepEqual(sent,['prompts']);
});

test('other-project generation does not block this project; switching state does', async () => {
  const s = fixture();s.tasks=[{id:'other-job',projectId:'other',status:'running'}];
  let sent=0;
  await runContinuation(owner,{snapshot:()=>s,saveAndRead:async()=>s.data!,execute:async()=>{sent++;return {};}});
  assert.equal(sent,1);
  assert.throws(()=>assertContinuationOwner(owner,{...s,switching:true}));
});
test('an owner change after model execution stops before readback or subsequent stages', async () => {
  const s=fixture();let reads=0;
  await assert.rejects(runContinuation(owner,{snapshot:()=>s,saveAndRead:async()=>{reads++;return s.data!;},execute:async()=>{s.unifiedId='other';return {};}}),/项目已切换/);
  assert.equal(reads,1);
});

test('ad asset continuation requires actionable decisions and isolates product blockers', () => {
  const data = fixture().data!;
  data.creativeSpec = { workKind:'product-ad' } as typeof data.creativeSpec;
  const prompt = buildContinueAutoRunPrompt('assets', data);
  for (const rule of ['workshop_read_ad_reference_images', '不能只在最终回复中要求上传', '独立可执行', 'asset_ids', '不是已上传', 'ask_user_question']) assert.ok(prompt.includes(rule), rule);
});
test('non-ad assets keep their existing policy', () => {
  assert.ok(!buildContinueAutoRunPrompt('assets', fixture().data!).includes('不能只在最终回复中要求上传'));
});

test('ref2va continuation does not demand unused storyboard or boundary frame prompts', () => {
  const s = fixture();
  s.data!.videoModel = 'minimax-h3';
  s.data!.h3InputMode = 'ref2va';
  s.data!.shots[0].universalVideoPrompt = '参考图生成产品广告';
  assert.equal(nextContinuationStage(s.data!), 'generate');
  s.data!.shots[0].h3VideoPromptModeStale = true;
  assert.equal(nextContinuationStage(s.data!), 'prompts');
});

test('广告一键：剧本落库后自动接续拆解，不把剧本和拆解当作同一阶段', async () => {
  const s = fixture();
  s.data!.shots = [];
  s.data!.creativeSpec = {workKind:'product-ad', adSpec:{productName:'GAI',researchMode:'provided-only'}} as any;
  s.data!.ideaDraft = '实体工作站广告';
  s.data!.creativeSpec!.adSpec!.materials = { fingerprint: adMaterialsFingerprint(s.data!.creativeSpec!.adSpec!), sources: [] } as any;
  assert.equal(nextContinuationStage(s.data!), 'script');
  const sent: string[] = [];
  await runContinuation(owner, {snapshot:()=>s, saveAndRead:async()=>structuredClone(s.data!), execute:async stage=>{
    sent.push(stage);
    if (stage === 'script') {
      s.data!.currentScriptRevisionId = 'r1';
      s.data!.scriptRevisions = [{id:'r1',content:'正式剧本',sourceKind:'idea'}] as any;
      return {};
    }
    return {error:'test boundary'};
  }});
  assert.deepEqual(sent, ['script','breakdown']);
  const prompt = buildContinueAutoRunPrompt('breakdown',s.data!);
  assert.match(prompt,/已保存的正式剧本/);
  assert.match(prompt,/不阻止.*拆解/);
});
