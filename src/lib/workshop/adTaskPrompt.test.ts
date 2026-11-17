import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdTaskContext, AD_RESEARCH_RULES } from './adTaskPrompt.ts';
import { buildProductAdPrompt } from './adSpec.ts';
import { buildAutoRunSteps } from './workshopPrompts.ts';
import { resolveWorkshopExecutionTask } from '../agent/executionRecovery.ts';
import { emptyWorkshopData } from './types.ts';
const spec = {productName:'测试软件',productCategory:'software',audience:['partner'],objective:'explainer',durationSec:30,keyMessage:'',complianceSensitive:false} as const;
const makeSpec = () => ({...spec,audience:[...spec.audience]});
test('DSH ad research distinguishes evidence, identity images and creative references',()=>{
 const prompt=buildProductAdPrompt('原始要求：讲清使用场景',makeSpec());
 for(const term of ['workshop_publish_ad_research','DSH','web_search','web_fetch','图片','来源','授权','付费','workshop_set_script_review','workshop_set_step_status']) assert.ok(prompt.includes(term),term);
 assert.doesNotMatch(prompt,/每个源文件只读一次|必须先调用 workshop_prepare_ad_materials|前 3 秒必须/);
 assert.ok(prompt.includes(AD_RESEARCH_RULES));
});
test('manual ad task receives original brief but does not expand its scope',()=>{
 const d=emptyWorkshopData('a');d.ideaDraft='完整原始 brief';d.creativeSpec={workKind:'product-ad',adSpec:makeSpec()} as any;
 const context=buildAdTaskContext(d,'只修改旁白');
 assert.match(context,/完整原始 brief/);assert.match(context,/不扩大/);assert.match(context,/测试软件/);
 const prompt=buildProductAdPrompt(d.ideaDraft,makeSpec());
 const combined=buildAdTaskContext(d,prompt)+prompt;
 assert.equal(combined.split(AD_RESEARCH_RULES).length-1,1);
 assert.equal(combined.split(d.ideaDraft).length-1,1);
});
test('non-ad context is untouched',()=>assert.equal(buildAdTaskContext(emptyWorkshopData('d'),'继续'),''));
test('ad first stage excludes short-drama read limits and arbitrary story quotas',()=>{
 const d=emptyWorkshopData('a');d.ideaDraft='产品说明广告';d.creativeSpec={workKind:'product-ad',adSpec:makeSpec()} as any;
 const prompt=buildAutoRunSteps('',{projectData:d,hasSourceFiles:false})[0].prompt;
 assert.match(prompt,/workshop_set_step_status/);
 assert.doesNotMatch(prompt,/每个源文件只读一次|3-12 条|不要自行虚构剧本|季纲/);
});

test('composed DSH request carries execution marker and respects offline selection',()=>{
 const d=emptyWorkshopData('a');d.ideaDraft='用户原始要求';d.creativeSpec={workKind:'product-ad',adSpec:{...makeSpec(),researchMode:'provided-only'}} as any;
 const request=buildProductAdPrompt(d.ideaDraft,d.creativeSpec!.adSpec!);
 const wire='[工坊上下文：项目测试]\n\n'+buildAdTaskContext(d,request)+request;
 assert.deepEqual(resolveWorkshopExecutionTask(wire,d),{kind:'breakdown',projectId:'a'});
 assert.match(wire,/仅用已提供资料，不得联网/);
 assert.equal(wire.split(AD_RESEARCH_RULES).length-1,1);
});

test('广告创建、自动首阶段和继续任务均从梗概规划资产身份与节拍', () => {
 const d=emptyWorkshopData('ad-upstream');d.ideaDraft='实体设备广告';
 d.creativeSpec={workKind:'product-ad',adSpec:makeSpec()} as any;
 const requests=[buildProductAdPrompt(d.ideaDraft,makeSpec()),buildAutoRunSteps('',{projectData:d,hasSourceFiles:false})[0].prompt,buildAdTaskContext(d,'继续')];
 for(const text of requests){
  for(const term of ['梗概阶段','资产身份与使用计划','同一资产的状态或版本','不同业务产物','来源关系','bibles.continuity.lockedItems','不提前锁死镜头数量']) assert.ok(text.includes(term),term);
  assert.doesNotMatch(text,/\uFFFD/);
 }
});

test('局部任务不得因上游设计要求而全量重做或虚构执行', () => {
 const d=emptyWorkshopData('ad-local');d.creativeSpec={workKind:'product-ad',adSpec:makeSpec()} as any;
 for(const request of ['只重写01-03提示词','核对当前状态','继续一键全流程']) {
  const text=buildAdTaskContext(d,request);
  for(const term of ['按请求范围','不自动重写梗概','受影响','不重放','H3 skill','真实工具回执']) assert.ok(text.includes(term),term);
 }
});

test('advertising entry points share causal creative development rather than feature montages', () => {
 const d=emptyWorkshopData('ad-story');d.ideaDraft='实体工作站广告';d.creativeSpec={workKind:'product-ad',adSpec:makeSpec()} as any;
 const requests=[buildProductAdPrompt(d.ideaDraft,makeSpec()),buildAutoRunSteps('',{projectData:d,hasSourceFiles:false})[0].prompt,buildAdTaskContext(d,'重写广告剧情')];
 for(const text of requests) {
  for(const term of ['【广告创意与剧情质量】','受众洞察','核心任务','产品介入的因果','品牌替换测试','删段测试','结果回扣开场','不强制人物故事','不新增确认关卡','不虚构期限','保留用户已经选定的创意']) assert.ok(text.includes(term),term);
  assert.equal(text.split('【广告创意与剧情质量】').length-1,1);
 }
});
