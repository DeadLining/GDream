import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutoRunSteps, validateAutoRunInput } from './workshopPrompts.ts';
import { emptyWorkshopData } from './types.ts';
const data = () => ({ ...emptyWorkshopData('test'), ideaDraft: '为合作伙伴介绍真实产品，不虚构参数', creativeSpec: {workKind:'product-ad',adSpec:{productName:'测试产品',productCategory:'physical',audience:['partner'],objective:'explainer',durationSec:60,complianceSensitive:false,keyMessage:'',researchMode:'provided-only'}} }) as any;
test('ad brief bootstraps creative production without nonexistent script precondition',()=>{
 const d=data();const steps=buildAutoRunSteps('风格A',{projectData:d,hasSourceFiles:false});
 assert.match(steps[0].prompt,/product-ad-director/);
 assert.match(steps[0].prompt,/为合作伙伴介绍真实产品/);
 assert.match(steps[0].prompt,/workshop_set_breakdown/);
 assert.match(steps[0].prompt,/workshop_set_script_review/);
 assert.match(steps[0].prompt,/不要生成任何图片或视频/);
 assert.doesNotMatch(steps[0].prompt,/若项目没有剧本源文件/);
 assert.deepEqual(steps.slice(1),buildAutoRunSteps('风格A').slice(1));
 assert.equal(validateAutoRunInput(d,false),null);
});
test('existing source or current script keeps normal breakdown and does not recreate from brief',()=>{
 const d=data();
 assert.doesNotMatch(buildAutoRunSteps('',{projectData:d,hasSourceFiles:true})[0].prompt,/product-ad-director/);
 d.scriptRevisions=[{id:'current',content:'正式剧本'}];d.currentScriptRevisionId='current';
 assert.doesNotMatch(buildAutoRunSteps('',{projectData:d,hasSourceFiles:false})[0].prompt,/product-ad-director/);
});
test('missing brief and missing product fail preflight without model invocation',()=>{
 const d=data(); d.ideaDraft='  ';assert.match(validateAutoRunInput(d,false)!,/brief/);
 d.ideaDraft='需求';d.creativeSpec.adSpec.productName='';assert.match(validateAutoRunInput(d,false)!,/产品/);
});
