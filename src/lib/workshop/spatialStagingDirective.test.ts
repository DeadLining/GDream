import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpatialStagingDirective, directorViewpointExecutionRuleEn, directorViewpointSelectionRulesZh, hasVerticalSpatialSeparation, inferSpatialStagingFromShotText, spatialStagingAuthoringRuleZh } from './spatialStagingDirective.ts';

const groundedVsAerial = {
  layers: [
    { subject: 'Sun Wukong', layer: 'ground' as const, support: 'rocky mountain ground' },
    { subject: 'Heavenly soldiers', layer: 'aerial' as const, support: 'cloud layer', relativeTo: 'above Sun Wukong' },
  ],
  viewpoint: 'upward' as const,
  relation: 'Sun Wukong remains grounded below the cloud-borne formation.',
};

test('ground versus aerial staging becomes an executable upward composition constraint', () => {
  assert.equal(hasVerticalSpatialSeparation(groundedVsAerial), true);
  const directive = buildSpatialStagingDirective(groundedVsAerial);
  assert.match(directive, /HARD SPATIAL TOPOLOGY/);
  assert.match(directive, /Sun Wukong: ground level/);
  assert.match(directive, /Heavenly soldiers: aerial \/ cloud \/ flight layer/);
  assert.match(directive, /relative position: above Sun Wukong/);
  assert.match(directive, /CAMERA VIEWPOINT: upward/);
  assert.match(directive, /tilt upward/);
  assert.match(directive, /upper frame/);
  assert.match(directive, /lower foreground/);
  assert.match(directive, /must not move a subject between ground, elevated, aerial/);
  assert.match(directive, /do not place both on one ground plane/);
});

test('camera movement never invents a layer transition or flattens a level shot', () => {
  const directive = buildSpatialStagingDirective({
    layers: [{ subject: 'Courier', layer: 'ground', support: 'station floor' }],
    viewpoint: 'level',
    relation: 'The courier remains on the station floor.',
  });
  assert.match(directive, /CAMERA VIEWPOINT: level/);
  assert.doesNotMatch(directive, /tilt upward/);
  assert.doesNotMatch(directive, /VERTICAL RELATION/);
});

test('ordinary single-layer shots do not receive a redundant vertical constraint', () => {
  assert.equal(hasVerticalSpatialSeparation({
    layers: [{ subject: 'Courier', layer: 'ground', support: 'station floor' }],
    viewpoint: 'level',
    relation: 'One person at the counter.',
  }), false);
  assert.match(spatialStagingAuthoringRuleZh(), /仰拍或低到高构图/);
  assert.match(spatialStagingAuthoringRuleZh(), /不改变人物所在世界层/);
  assert.match(directorViewpointSelectionRulesZh(), /平等的同层角色仍应平视/);
  assert.match(directorViewpointSelectionRulesZh(), /不能只凭“这是神话／都市／爱情”机械选角度/);
  assert.match(directorViewpointExecutionRuleEn(), /not from genre alone/);
  assert.match(directorViewpointExecutionRuleEn(), /ordinary conversation/);
});

test('legacy shots without structured staging still infer grounded versus aerial topology', () => {
  const staging = inferSpatialStagingFromShotText({
    description: '孙悟空站在花果山地上，天兵天将列阵压在云层上方。',
    camera: '镜头从地面向上仰拍云阵。',
  });
  assert.equal(staging?.viewpoint, 'upward');
  assert.equal(staging?.layers.some((entry) => entry.layer === 'ground'), true);
  assert.equal(staging?.layers.some((entry) => entry.layer === 'aerial'), true);
});

test('legacy inference does not fire for an ordinary grounded shot', () => {
  assert.equal(inferSpatialStagingFromShotText({
    description: '快递员站在站台地面，把包裹递给收件人。',
    camera: '中景平视。',
  }), undefined);
});

test('generic mythic oppression infers a low-angle power composition', () => {
  const staging = inferSpatialStagingFromShotText({
    description: '主角站在地面上，神将率领云阵压向人群，逼迫他们投降。',
    projectGenre: '神话',
    storyTone: '压迫、反抗',
  });
  assert.equal(staging?.viewpoint, 'upward');
  assert.match(staging?.dramaticIntent ?? '', /dominance/);
  assert.match(staging?.cameraMotivation ?? '', /spatial\/dramatic advantage/);
});

test('explicit downward framing survives only as an intentional vulnerability choice', () => {
  const staging = inferSpatialStagingFromShotText({
    description: '主角跪在地上，神将站在高台上俯拍审视。',
    projectGenre: '神话',
  });
  assert.equal(staging?.viewpoint, 'downward');
  assert.match(staging?.cameraMotivation ?? '', /observed, judged or made vulnerable/);
});

test('equal-level supernatural conversation is not forced into an upward angle', () => {
  assert.equal(inferSpatialStagingFromShotText({
    description: '两位神祇坐在同一云台上平等议事，彼此平视交谈。',
    projectGenre: '神话',
    storyTone: '克制、平等',
  }), undefined);
});
