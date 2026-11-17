import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProductAdPrompt,
  deriveAdDirection,
  type AdCreativeSpec,
} from './adSpec.ts';

const base: AdCreativeSpec = {
  productName: '测试产品',
  productCategory: 'fmcg',
  audience: ['consumer'],
  objective: 'awareness',
  durationSec: 30,
};

test('政府受众要求合规资质与人工终审', () => {
  const d = deriveAdDirection({ audience: ['government'], objective: 'advocacy', productCategory: 'software' });
  assert.equal(d.primaryProof, 'credential');
  assert.equal(d.requiresHumanReview, true);
  assert.equal(d.riskTolerance, 'low');
  assert.ok(d.mustCarry.some((x) => x.includes('合规资质')));
  assert.ok(d.avoid.some((x) => x.includes('夸张承诺')));
});

test('合作商受众要求可量化条款', () => {
  const d = deriveAdDirection({ audience: ['partner'], objective: 'recruitment', productCategory: 'physical' });
  assert.equal(d.primaryProof, 'spec');
  assert.ok(d.mustCarry.some((x) => x.includes('可量化的合作条件')));
  assert.ok(d.avoid.some((x) => x.includes('品牌情绪')));
});

test('抽象程度跟随目标：大众认知型可以抽象', () => {
  const d = deriveAdDirection({ audience: ['consumer'], objective: 'awareness', productCategory: 'fmcg' });
  assert.equal(d.abstractLevel, 'abstract');
});

test('抽象程度跟随目标：大众转化型必须具体', () => {
  const d = deriveAdDirection({ audience: ['consumer'], objective: 'conversion', productCategory: 'fmcg' });
  assert.equal(d.abstractLevel, 'concrete');
  assert.ok(d.avoid.some((x) => x.includes('行动指令')));
});

test('高风险人群即使目标抽象也不得纯抽象', () => {
  const d = deriveAdDirection({ audience: ['government'], objective: 'awareness', productCategory: 'software' });
  assert.notEqual(d.abstractLevel, 'abstract');
  assert.equal(d.abstractLevel, 'balanced');
});

test('混合受众取最保守风险等级，不被宽松受众带跑', () => {
  const d = deriveAdDirection({ audience: ['consumer', 'government'], objective: 'awareness', productCategory: 'fmcg' });
  assert.equal(d.riskTolerance, 'low');
  assert.equal(d.primaryProof, 'credential');
  assert.equal(d.requiresHumanReview, true);
});

test('受众为空时保守回退到大众消费者', () => {
  const d = deriveAdDirection({ audience: [], objective: 'awareness', productCategory: 'fmcg' });
  assert.equal(d.primaryProof, 'feeling');
  assert.equal(d.summary.includes('大众消费者'), true);
});

test('软件类明确禁止编造未实现功能', () => {
  const d = deriveAdDirection({ audience: ['partner'], objective: 'explainer', productCategory: 'software' });
  assert.ok(d.avoid.some((x) => x.includes('编造未实现的功能')));
});

test('方向摘要包含受众、目标与抽象程度', () => {
  const d = deriveAdDirection({ audience: ['government'], objective: 'advocacy', productCategory: 'physical' });
  assert.ok(d.summary.includes('政府 / 监管'));
  assert.ok(d.summary.includes('政策 / 价值宣导'));
});

test('提示词把受众、目标和推导方向写进规格', () => {
  const spec: AdCreativeSpec = { ...base, audience: ['government'], objective: 'advocacy', productCategory: 'software' };
  const prompt = buildProductAdPrompt('为政务系统做宣传片', spec);
  assert.match(prompt, /product-ad-director/);
  assert.match(prompt, /政府 \/ 监管/);
  assert.match(prompt, /政策 \/ 价值宣导/);
  assert.match(prompt, /人工终审/);
  assert.match(prompt, /workshop_set_breakdown/);
  assert.match(prompt, /为政务系统做宣传片/);
  assert.doesNotMatch(prompt, /故事编排导演/);
});

test('提示词对转化型目标给出 CTA 要求', () => {
  const prompt = buildProductAdPrompt('卖气泡水', { ...base, objective: 'conversion' });
  assert.match(prompt, /明确 CTA/);
});
