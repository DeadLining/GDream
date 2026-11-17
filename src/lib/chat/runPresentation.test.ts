import test from 'node:test';
import assert from 'node:assert/strict';
import { evidencedStepStatus, safeEvidence, settledRun, savedShotOutcome } from './runPresentation.ts';
import { presentInput } from './inputPresentation.ts';
import { emptyWorkshopData } from '../workshop/types.ts';
import type { RunStep, RunSession } from '../../stores/runStepStore';
test('model plan or final text cannot prove completed steps', () => {
 const step = { status:'done', toolCalls:[], subAgents:[] } as unknown as RunStep;
 assert.equal(evidencedStepStatus(step),'pending');
 assert.equal(evidencedStepStatus({...step,toolCalls:[{status:'failed'} as never]}),'failed');
});
test('long input and system context remain lossless', () => {
 const body='用户原始要求\n'.repeat(2000), full='[工坊上下文：仅执行当前项目]\n\n'+body;
 const p=presentInput(full); assert.equal(p.fullText,full); assert.equal(p.userText,body);
 assert.equal(p.generated,false); assert.ok(p.context.includes('工坊上下文'));
 assert.equal(presentInput('[一键全流程 · 第 4/4 步]\n范围：8 镜\n先确认').generated,true);
});
test('saved shot snapshots require a successful receipt and matching project', () => {
 const data=emptyWorkshopData('p');data.shots=[{shotNo:'01',description:'画面',characterIds:[],durationSec:5,camera:'推进',dialogue:'旁白'}];
 assert.equal(savedShotOutcome('workshop_set_shots',{shots:[{shotNo:'01'}]},false,data,'p','t'),undefined);
 assert.equal(savedShotOutcome('workshop_set_shots',{shots:[{shotNo:'01'}]},true,data,'other','t'),undefined);
 const outcome=savedShotOutcome('workshop_set_shots',{shots:[{shotNo:'01'}]},true,data,'p','t')!;
 data.shots[0].description='later';assert.equal(outcome.shots[0].description,'画面');
});
test('restart never restores execution or payment authority', () => {
 const run={status:'running',steps:[{status:'active',toolCalls:[{status:'running'}]}],decisions:[{status:'pending'}]} as unknown as RunSession;
 const restored=settledRun(run);assert.equal(restored.status,'aborted');assert.equal(restored.decisions?.[0].status,'interrupted');
 assert.equal(restored.steps[0].toolCalls[0].status,'interrupted');
});
test('technical evidence strips secrets but retains full business text', () => {
 const full='长业务结果'.repeat(3000);assert.deepEqual(safeEvidence({apiKey:'secret',full}),{apiKey:'[已隐藏]',full});
});

test('subtask status derives from receipts, not model text', () => {
 const step = {status:'skipped',toolCalls:[],subAgents:[{status:'completed'}]} as unknown as RunStep;
 assert.equal(evidencedStepStatus(step),'done');
 const restored=settledRun({status:'running',steps:[{...step,subAgents:[{status:'running'}]}]} as unknown as RunSession);
 assert.equal(restored.steps[0].subAgents[0].status,'failed');
 assert.equal(evidencedStepStatus(restored.steps[0]),'failed');
});

test('serialized receipts and summaries redact credentials without shortening business text', () => {
 const business='保留完整业务内容'.repeat(1000);
 const inputs=[
   JSON.stringify({apiKey:'FAKE_SECRET_ONE',nested:JSON.stringify({password:'FAKE_SECRET_TWO'}),business}),
   'ERROR {"api_key":"FAKE_SECRET_THREE", "business":"ok"}',
   'password=FAKE_SECRET_FOUR authorization: Basic FAKE_SECRET_FIVE',
   'https://example.test/a?X-Amz-Credential=FAKE_SECRET_SIX&X-Amz-Signature=FAKE_SECRET_SEVEN',
 ];
 for(const input of inputs) assert.doesNotMatch(safeEvidence(input) as string,/FAKE_SECRET/);
 const output=safeEvidence(inputs[0]) as string;
 assert.equal(JSON.parse(output).business,business);
 assert.equal(safeEvidence(output),output);
 assert.equal(safeEvidence(business),business);
});
