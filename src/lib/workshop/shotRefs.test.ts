import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import {
  applyVideoPlanningReferencePrefixes,
  buildStoryboardFrameRefBindings,
  buildImageRefBindings,
  buildRefAwarePatch,
  buildVideoRefBindings,
  effectiveOpeningCharacterIds,
  getBoundaryFrameBindings,
  compactStoryboardFrameReferences,
  ensureDirectorConstraintMention,
  ensureUniversalVideoPromptAssetMentions,
  numToCn,
  patchTouchesRefs,
  remapShotPromptRefs,
  seedance25PromptForShot,
  stripDirectorConstraintMention,
  stripRuntimeBoundaryImageMentions,
  videoPromptForShot,
  validateShotReferenceBindings,
  type ShotRefsContext,
} from './shotRefs.ts';
import type { WsShot } from './types.ts';

const ctx: ShotRefsContext = {
  scenes: [{ id: 'scene-1', name: '书房', assetImagePath: '/assets/scene.png' }],
  characters: [{ id: 'char-1', name: '姮氏', assetImagePath: '/assets/character.png' }],
  props: [{ id: 'prop-1', name: '古图', assetImagePath: '/assets/prop.png' }],
  colorPalettes: [{ id: 'palette-1', name: '青铜夜色', assetImagePath: '/assets/palette.png' }],
  globalColorPaletteId: 'palette-1',
};

const shot: WsShot = {
  shotNo: '01-01',
  description: '人物在书房展开古图',
  sceneId: 'scene-1',
  characterIds: ['char-1'],
  propIds: ['prop-1'],
  extraRefImages: ['/assets/extra.png'],
};

test('reference mutations remap H3 Picture tokens without collapsing section boundaries', () => {
  const source: WsShot = {
    ...shot,
    universalVideoPrompt: 'subject_definitions:\n<Subject 1>: Based on <Picture 2>.\n\nsummary:\nKeep <Picture 3> and <Picture 5>.\n\ndetailed_description:\n[Shot 1] Preserve <Picture 99>.',
    videoPrompt: 'Use <Picture 2>, <Picture 3>, and @图片五.',
  };
  const patch = buildRefAwarePatch(source, { propIds: [] }, ctx);
  assert.equal(patch.videoPrompt, 'Use <Picture 2>, , and @图片四.');
  assert.match(patch.universalVideoPrompt!, /<Subject 1>: Based on <Picture 2>\.\n\nsummary:/);
  assert.match(patch.universalVideoPrompt!, /Keep and <Picture 4>/);
  assert.match(patch.universalVideoPrompt!, /\n\ndetailed_description:/);
  assert.match(patch.universalVideoPrompt!, /Preserve <Picture 99>/, 'unknown references stay visible for validation');
});

test('storyboard canvas refs preserve the canonical asset order', () => {
  const refs = buildStoryboardFrameRefBindings(shot, {}, ctx);

  assert.deepEqual(
    refs.map((ref) => [ref.index, ref.kind, ref.path]),
    [
      [1, 'scene', '/assets/scene.png'],
      [2, 'character', '/assets/character.png'],
      [3, 'prop', '/assets/prop.png'],
      [4, 'extra', '/assets/extra.png'],
      [5, 'palette', '/assets/palette.png'],
    ],
  );
});

test('storyboard canvas refs follow the frame snapshot and keep missing historical assets visible', () => {
  const refs = buildStoryboardFrameRefBindings(
    shot,
    {
      refImagePaths: [
        '/assets/character.png',
        '/assets/scene.png',
        '/assets/legacy-reference.png',
      ],
    },
    ctx,
  );

  assert.deepEqual(
    refs.map((ref) => [ref.index, ref.kind, ref.path]),
    [
      [1, 'character', '/assets/character.png'],
      [2, 'scene', '/assets/scene.png'],
      [3, 'extra', '/assets/legacy-reference.png'],
    ],
  );
  assert.equal(refs[2].label, '历史参考 3');
});

test('storyboard frame references are compacted and renumbered inside the frame', () => {
  const compacted = compactStoryboardFrameReferences(
    shot,
    {
      prompt: '保持@图片一的空间，并让人物参考@图片三进入画面。',
      refImagePaths: [
        '/assets/scene.png',
        '/assets/character.png',
        '/assets/prop.png',
        '/assets/extra.png',
        '/assets/palette.png',
      ],
    },
    ctx,
  );

  assert.equal(compacted.prompt, '保持@图片一的空间，并让人物参考@图片二进入画面。');
  assert.deepEqual(
    compacted.bindings.map((ref) => [ref.index, ref.path]),
    [
      [1, '/assets/scene.png'],
      [2, '/assets/prop.png'],
    ],
  );
});

test('director constraint card is opt-in and appended after normal storyboard refs', () => {
  const withCard: WsShot = {
    ...shot,
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
    },
  };

  const disabled = buildStoryboardFrameRefBindings(withCard, {}, ctx);
  assert.equal(disabled.some((ref) => ref.kind === 'directorConstraintCard'), false);

  const enabled = buildStoryboardFrameRefBindings(
    withCard,
    { useDirectorConstraintCard: true },
    ctx,
  );
  assert.deepEqual(enabled[enabled.length - 1], {
    index: 6,
    kind: 'directorConstraintCard',
    label: '导演约束卡',
    path: '/assets/director-card.png',
    id: 'director-card-1',
  });
});

test('video refs place the active director constraint card after storyboard boards', () => {
  const withPlanningAssets: WsShot = {
    ...shot,
    storyboardBoards: [{
      id: 'board-1',
      frameIds: [],
      imagePath: '/assets/board.png',
      createdAt: 1,
      useInVideo: true,
    }],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
  };

  const refs = buildVideoRefBindings(withPlanningAssets, ctx);
  assert.deepEqual(
    refs.slice(0, 3).map((ref) => [ref.index, ref.kind, ref.path]),
    [
      [1, 'storyboardBoard', '/assets/board.png'],
      [2, 'directorConstraintCard', '/assets/director-card.png'],
      [3, 'scene', '/assets/scene.png'],
    ],
  );
});

test('formal video refs exclude unapproved storyboard boards', () => {
  const unapprovedShot: WsShot = {
    ...shot,
    storyboardFrames: [{
      id: 'frame-1', prompt: 'panel', imagePath: '/tmp/frame.png', candidates: [{ path: '/tmp/frame.png', source: 'generate' as const, createdAt: 1 }],
    }],
    storyboardBoards: [{ id: 'board-1', frameIds: ['frame-1'], imagePath: '/tmp/board.png', createdAt: 1 }],
  };
  const ctx = { scenes: [], characters: [], props: [] };
  assert.equal(buildVideoRefBindings(unapprovedShot, ctx, { requireApprovedStoryboardBoards: true }).some((ref) => ref.kind === 'storyboardBoard'), false);
});

test('Seedance 2.5 hides storyboard boards but keeps and renumbers the director card', () => {
  const seedance25Shot: WsShot = {
    ...shot,
    storyboardBoards: [
      { id: 'board-1', frameIds: [], imagePath: '/assets/board-1.png', createdAt: 1, useInVideo: true },
      { id: 'board-2', frameIds: [], imagePath: '/assets/board-2.png', createdAt: 2, useInVideo: true },
    ],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
    videoPrompt: '以分镜板 @图片一、@图片二作为画面参考。\n以 @导演约束卡（对应 @图片三）锁定调度。\n人物参考 @图片五。',
  };

  const refs = buildVideoRefBindings(seedance25Shot, ctx, { includeStoryboardBoards: false });
  const prompt = seedance25PromptForShot(seedance25Shot, ctx);

  assert.deepEqual(refs.slice(0, 3).map((ref) => [ref.index, ref.kind, ref.path]), [
    [1, 'directorConstraintCard', '/assets/director-card.png'],
    [2, 'scene', '/assets/scene.png'],
    [3, 'character', '/assets/character.png'],
  ]);
  assert.equal(refs.some((ref) => ref.kind === 'storyboardBoard'), false);
  assert.doesNotMatch(prompt, /分镜板/);
  assert.match(prompt, /^以 @导演约束卡（对应 @图片一）/);
  assert.match(prompt, /人物参考 @图片三/);
});

test('asset-driven video mode excludes planning images and keeps production assets', () => {
  const plannedShot: WsShot = {
    ...shot,
    storyboardBoards: [{ id: 'board-1', frameIds: [], imagePath: '/assets/board.png', createdAt: 1, useInVideo: true }],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
  };

  const refs = buildVideoRefBindings(plannedShot, ctx, {
    includeStoryboardBoards: false,
    includeDirectorConstraintCard: false,
  });

  assert.equal(refs.some((ref) => ref.kind === 'storyboardBoard'), false);
  assert.equal(refs.some((ref) => ref.kind === 'directorConstraintCard'), false);
  assert.deepEqual(refs.slice(0, 3).map((ref) => ref.kind), ['scene', 'character', 'prop']);
});

test('Seedance 2.5 keeps its own rewritten prompt without changing the normal prompt', () => {
  const seedance25Shot: WsShot = {
    ...shot,
    storyboardBoards: [{ id: 'board-1', frameIds: [], imagePath: '/assets/board.png', createdAt: 1, useInVideo: true }],
    videoPrompt: '普通模型继续使用 @图片一 分镜板。',
    seedance25VideoPrompt: '【素材描述】@图片一为书房；@图片二为姮氏。',
  };

  const prompt = seedance25PromptForShot(seedance25Shot, ctx);
  assert.equal(seedance25Shot.videoPrompt, '普通模型继续使用 @图片一 分镜板。');
  assert.match(prompt, /@图片一为书房/);
  assert.match(prompt, /@图片二为姮氏/);
});

test('director constraint prompt mention is stable and removable', () => {
  const once = ensureDirectorConstraintMention('第1格：人物走向桌边。', 6);
  const twice = ensureDirectorConstraintMention(once, 7);

  assert.match(twice, /^参考 @导演约束卡（对应 @图片七）/);
  assert.equal(twice.match(/@导演约束卡/g)?.length, 1);
  assert.equal(stripDirectorConstraintMention(twice), '第1格：人物走向桌边。');
});

test('video planning prefixes mention both storyboard board and director constraint card once', () => {
  const withPlanningAssets: WsShot = {
    ...shot,
    storyboardBoards: [{
      id: 'board-1',
      frameIds: [],
      imagePath: '/assets/board.png',
      createdAt: 1,
      useInVideo: true,
    }],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
  };
  const once = applyVideoPlanningReferencePrefixes(withPlanningAssets, '人物走向桌边。');
  const twice = applyVideoPlanningReferencePrefixes(withPlanningAssets, once);

  assert.equal(twice.match(/以分镜板/g)?.length, 1);
  assert.equal(twice.match(/@导演约束卡/g)?.length, 1);
  assert.match(twice, /@导演约束卡（对应 @图片二）/);
  assert.match(twice, /人物走向桌边。/);
  assert.match(twice, /【连续性与生成约束】/);
});

test('Seedance 2.0 keeps storyboard and director prefixes for both prompt templates', () => {
  const plannedShot: WsShot = {
    ...shot,
    storyboardBoards: [{
      id: 'board-1',
      frameIds: [],
      imagePath: '/assets/board.png',
      createdAt: 1,
      useInVideo: true,
    }],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
    videoPrompt: '原有模板正文。',
    universalVideoPrompt: '【素材身份】通用模板正文。',
  };

  const legacy = videoPromptForShot(plannedShot, ctx, {
    template: 'legacy',
    includeStoryboardBoards: true,
  });
  const universal = videoPromptForShot(plannedShot, ctx, {
    template: 'universal',
    includeStoryboardBoards: true,
  });

  for (const prompt of [legacy, universal]) {
    assert.match(prompt, /^以分镜板@图片一/);
    assert.match(prompt, /@导演约束卡（对应 @图片二）/);
  }
  assert.match(legacy, /原有模板正文。/);
  assert.match(universal, /通用模板正文。/);
  assert.match(legacy, /【连续性与生成约束】/);
  assert.match(universal, /【连续性与生成约束】/);
});

test('template switching preserves both saved prompt variants', () => {
  const dualPromptShot: WsShot = {
    ...shot,
    videoPrompt: '原有版本保持不变。',
    universalVideoPrompt: '【素材身份】通用版本保持不变。',
  };

  const legacy = videoPromptForShot(dualPromptShot, ctx, {
    template: 'legacy',
    includeStoryboardBoards: true,
  });
  const universal = videoPromptForShot(dualPromptShot, ctx, {
    template: 'universal',
    includeStoryboardBoards: true,
  });

  assert.match(legacy, /^原有版本保持不变。/);
  assert.match(legacy, /【连续性与生成约束】/);
  assert.match(universal, /通用版本保持不变。/);
  for (const ref of buildVideoRefBindings(dualPromptShot, ctx)) {
    assert.match(universal, new RegExp(`@图片${numToCn(ref.index)}`));
  }
  assert.equal(dualPromptShot.videoPrompt, '原有版本保持不变。');
  assert.equal(dualPromptShot.universalVideoPrompt, '【素材身份】通用版本保持不变。');
});

test('universal template does not masquerade the classic prompt when unsaved', () => {
  const classicOnlyShot: WsShot = {
    ...shot,
    videoPrompt: '经典版正文必须保留，但不能显示成新版。',
    universalVideoPrompt: '',
    seedance25VideoPrompt: '',
  };

  const universal = videoPromptForShot(classicOnlyShot, ctx, {
    template: 'universal',
    includeStoryboardBoards: false,
    includeDirectorConstraintCard: false,
  });

  assert.equal(universal, '');
  assert.equal(classicOnlyShot.videoPrompt, '经典版正文必须保留，但不能显示成新版。');
});

test('universal prompt deterministically fills missing submitted asset mentions', () => {
  const prompt = ensureUniversalVideoPromptAssetMentions(
    `【素材身份】\n@图片一为场景参考。\n【时间戳动作与机位】\n0-5s：人物走到桌前。`,
    [
      { index: 1, kind: 'scene', label: '咖啡店', path: '/scene.png' },
      { index: 2, kind: 'character', label: '女孩', path: '/girl.png' },
      { index: 3, kind: 'prop', label: '咖啡杯', path: '/cup.png' },
    ],
  );

  assert.match(prompt, /@图片一为场景参考/);
  assert.match(prompt, /@图片二：女孩/);
  assert.match(prompt, /@图片三：咖啡杯/);
  assert.equal((prompt.match(/@图片一/g) ?? []).length, 1);
});

test('universal video prompt output includes every active reference', () => {
  const universalShot: WsShot = {
    ...shot,
    universalVideoPrompt: '【时间戳动作与机位】\n0-5s：人物走到桌前。',
  };
  const prompt = videoPromptForShot(universalShot, ctx, {
    template: 'universal',
    includeStoryboardBoards: false,
    includeDirectorConstraintCard: false,
  });
  const refs = buildVideoRefBindings(universalShot, ctx, {
    includeStoryboardBoards: false,
    includeDirectorConstraintCard: false,
  });

  for (const ref of refs) assert.match(prompt, new RegExp(`@图片${numToCn(ref.index)}`));
  assert.doesNotMatch(prompt, /\.png\b/i);
});

test('video prompt automatically appends one idempotent controlled transition block', () => {
  const transitionShot: WsShot = {
    ...shot,
    videoPrompt: '人物抬手靠近镜头，保持动作连续。',
    transitionPlan: {
      kind: 'occlusion',
      trigger: '手掌完全遮满镜头',
      target: '清晨站台的同构图',
      prompt: '保持人物身份、动作方向和构图一致。',
    },
  };

  const once = videoPromptForShot(transitionShot, ctx, { template: 'legacy', includeStoryboardBoards: true });
  const twice = applyVideoPlanningReferencePrefixes(transitionShot, once);

  assert.match(once, /【受控转场】/);
  assert.match(once, /遮挡转场/);
  assert.match(once, /手掌完全遮满镜头/);
  assert.match(once, /清晨站台的同构图/);
  assert.equal((twice.match(/【受控转场】/g) ?? []).length, 1);
  assert.equal((twice.match(/【连续性与生成约束】/g) ?? []).length, 1);
});

test('video prompt appends the detailed chronological continuity guard', () => {
  const prompt = videoPromptForShot({
    ...shot,
    atomicAction: '中年男子与粉色衣服的年轻女子完成挽臂拥抱',
    videoPrompt: '0.0-8.0s：按时间轴完成动作。',
  }, ctx, {
    template: 'legacy',
    includeStoryboardBoards: true,
  });
  assert.match(prompt, /保持时间轴的因果顺序和核心动作结果/);
  assert.match(prompt, /挽臂拥抱/);
  assert.match(prompt, /不要引入新人物、新场景、新道具/);
  assert.match(prompt, /人物可以依据剧情自然走动、转身、靠近、后退/);
  assert.match(prompt, /脚下落点、躯干\/骨盆朝向、脸部朝向、视线目标和屏幕方向/);
  assert.match(prompt, /台阶踏步、栏杆、门框、桌面、车辆或另一人物肩线/);
  assert.match(prompt, /不得改变人物真实尺度/);
  assert.match(prompt, /时间轴每个区间都要交代主要人物和关键道具所在支撑平面/);
  assert.match(prompt, /必须先通过走近、下阶、跨步、俯身、伸手或已设定的超自然位移进入可达空间/);
  assert.match(prompt, /距离如何缩短或拉开/);
  assert.match(prompt, /进入伸手或落脚范围/);
  assert.match(prompt, /瞬移、闪现、缩地、遁光或空间跃迁/);
  assert.match(prompt, /相对目标的落点\/朝向\/距离/);
  assert.match(prompt, /再自然承接踩踏、攻击、交接或其他后续动作/);
  assert.match(prompt, /没有指定对白，所有角色不形成可辨识语言或说话音节/);
  assert.match(prompt, /双唇可以自然合拢或微松/);
  assert.match(prompt, /允许一次服务核心动作或情绪落点的表情、手部、动作接触或道具特写/);
  assert.match(prompt, /特写只改变取景范围或焦点/);
  assert.match(prompt, /不得镜像翻面、凭空换边、无因转身或改变身高体型/);
  assert.match(prompt, /首帧、尾帧与本提示词的起止状态一致/);
});

test('universal prompt removes H3 runtime boundary references from the saved base prompt', () => {
  const prompt = stripRuntimeBoundaryImageMentions(`【素材身份】
- @图片一：场景。
- @图片六：当前镜首帧。
- @图片七：当前镜尾帧。
【时间戳动作与机位】
0-5s：人物参考 @图片二 向前走，不直接引用 @图片六。`, 5);

  assert.match(prompt, /@图片一/);
  assert.match(prompt, /@图片二/);
  assert.doesNotMatch(prompt, /@图片六|@图片七/);
  assert.doesNotMatch(prompt, /当前镜首帧|当前镜尾帧/);
});

test('universal Seedance 2.5 prefers the new prompt, hides storyboards and keeps the director card', () => {
  const plannedShot: WsShot = {
    ...shot,
    storyboardBoards: [{
      id: 'board-1',
      frameIds: [],
      imagePath: '/assets/board.png',
      createdAt: 1,
      useInVideo: true,
    }],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
    universalVideoPrompt: '参考 @图片四 完成人物动作。',
    seedance25VideoPrompt: '【素材身份】@图片一为导演约束卡，@图片三为人物。',
  };

  const prompt = videoPromptForShot(plannedShot, ctx, {
    template: 'universal',
    includeStoryboardBoards: false,
  });

  assert.doesNotMatch(prompt, /分镜板/);
  assert.match(prompt, /^以 @导演约束卡（对应 @图片一）/);
  assert.match(prompt, /参考 @图片三 完成人物动作/);
  assert.doesNotMatch(prompt, /【素材身份】@图片一为导演约束卡/);
});

test('universal Seedance 2.5 falls back to the historical no-storyboard prompt', () => {
  const plannedShot: WsShot = {
    ...shot,
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
    universalVideoPrompt: '',
    seedance25VideoPrompt: '【素材身份】@图片一为导演约束卡，@图片二为人物。',
  };

  const prompt = videoPromptForShot(plannedShot, ctx, {
    template: 'universal',
    includeStoryboardBoards: false,
  });

  assert.match(prompt, /^以 @导演约束卡（对应 @图片一）/);
  assert.match(prompt, /【素材身份】[\s\S]*@图片一为导演约束卡/);
});

test('video planning prefix keeps the director constraint card visible as the third reference', () => {
  const withTwoBoards: WsShot = {
    ...shot,
    storyboardBoards: [
      { id: 'board-1', frameIds: [], imagePath: '/assets/board-1.png', createdAt: 1, useInVideo: true },
      { id: 'board-2', frameIds: [], imagePath: '/assets/board-2.png', createdAt: 2, useInVideo: true },
    ],
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card.png',
      createdAt: 1,
      useInVideo: true,
    },
  };

  const refs = buildVideoRefBindings(withTwoBoards, ctx);
  const prompt = applyVideoPlanningReferencePrefixes(withTwoBoards, '人物走向桌边。');

  assert.equal(refs[2]?.kind, 'directorConstraintCard');
  assert.match(prompt, /@导演约束卡（对应 @图片三）/);
  assert.equal(prompt.match(/@图片三/g)?.length, 1);
});

test('director constraint card works as the only video reference without storyboard boards', () => {
  const cardOnlyShot: WsShot = {
    shotNo: '01-02',
    description: '只按导演约束卡完成调度',
    characterIds: [],
    directorConstraintCard: {
      id: 'director-card-only',
      imagePath: '/assets/director-card-only.png',
      createdAt: 1,
      useInVideo: true,
    },
  };

  const refs = buildVideoRefBindings(cardOnlyShot, {
    scenes: [],
    characters: [],
    props: [],
    colorPalettes: [],
  });
  const prompt = applyVideoPlanningReferencePrefixes(cardOnlyShot, '按卡片中的人物动线完成镜头。');

  assert.deepEqual(refs.map((ref) => [ref.index, ref.kind, ref.path]), [
    [1, 'directorConstraintCard', '/assets/director-card-only.png'],
  ]);
  assert.match(prompt, /^以 @导演约束卡（对应 @图片一）/);
});

test('replacing a director constraint card removes the previous card from frame snapshots', () => {
  const oldShot: WsShot = {
    ...shot,
    directorConstraintCard: {
      id: 'director-card-1',
      imagePath: '/assets/director-card-old.png',
      createdAt: 1,
    },
    storyboardFrames: [{
      id: 'frame-1',
      prompt: ensureDirectorConstraintMention('第1格：人物走向桌边。', 6),
      refImagePaths: [
        '/assets/scene.png',
        '/assets/character.png',
        '/assets/prop.png',
        '/assets/extra.png',
        '/assets/palette.png',
        '/assets/director-card-old.png',
      ],
      useDirectorConstraintCard: true,
    }],
  };
  const nextShot: WsShot = {
    ...oldShot,
    directorConstraintCard: {
      ...oldShot.directorConstraintCard!,
      imagePath: '/assets/director-card-new.png',
    },
  };
  const remapped = remapShotPromptRefs(oldShot, nextShot, ctx);
  const frame = remapped.storyboardFrames?.[0];

  assert.equal(frame?.refImagePaths?.includes('/assets/director-card-old.png'), false);
  assert.equal(frame?.refImagePaths?.[(frame.refImagePaths?.length ?? 1) - 1], '/assets/director-card-new.png');
  assert.equal(frame?.refImagePaths?.length, 6);
});

test('asset image replacement preserves semantic @ order even when the file path changes', () => {
  const oldShot: WsShot = {
    ...shot,
    imagePrompt: '@图片一是书房，姮氏@图片二展开古图@图片三。',
    videoPrompt: '姮氏@图片二在书房@图片一展开古图@图片三。',
  };
  const nextCtx: ShotRefsContext = {
    ...ctx,
    characters: [{ id: 'char-1', name: '姮氏', assetImagePath: '/assets/character-v2.png' }],
  };
  const remapped = remapShotPromptRefs(oldShot, oldShot, ctx, nextCtx);

  assert.equal(remapped.imagePrompt, oldShot.imagePrompt);
  assert.equal(remapped.videoPrompt, oldShot.videoPrompt);
  assert.equal(remapped.referenceRevision, 1);
});

test('removed assets do not leave a stale @图片N pointing at the next asset', () => {
  const oldShot: WsShot = {
    ...shot,
    imagePrompt: '姮氏@图片二拿起古图@图片三，参考@图片四。',
  };
  const nextShot: WsShot = {
    ...oldShot,
    propIds: [],
  };
  const remapped = remapShotPromptRefs(oldShot, nextShot, ctx);

  assert.doesNotMatch(remapped.imagePrompt ?? '', /古图@图片三/);
  assert.match(remapped.imagePrompt ?? '', /参考@图片三/);
});

test('legacy white-model paths are excluded from H3 boundary references', () => {
  const legacy: WsShot = {
    ...shot,
    extraRefImages: ['/assets/white_model_preview.png', '/assets/handwritten-note.png'],
  };
  const refs = getBoundaryFrameBindings(legacy, ctx);
  assert.deepEqual(refs.map((ref) => ref.path), [
    '/assets/scene.png',
    '/assets/character.png',
    '/assets/prop.png',
    '/assets/handwritten-note.png',
    '/assets/palette.png',
  ]);
});

test('duplicate character IDs produce one reference image', () => {
  const refs = buildVideoRefBindings({ ...shot, characterIds: ['char-1', 'char-1'] }, ctx);
  assert.equal(refs.filter((ref) => ref.kind === 'character').length, 1);
});

test('explicit empty prop reference set keeps the object as text without requiring its image', () => {
  const sparse: WsShot = { ...shot, assetPropIds: [], incidentalObjects: ['普通纸张放在桌上'], imagePrompt: '姮氏@图片二在书房@图片一展开普通纸张，参考@图片四。' };
  const bindings = buildImageRefBindings(sparse, ctx);
  assert.equal(bindings.some((ref) => ref.kind === 'prop'), false);
  assert.deepEqual(validateShotReferenceBindings(sparse, bindings, ctx), []);
  assert.equal(buildVideoRefBindings(sparse, ctx).some((ref) => ref.kind === 'prop'), false);
  assert.deepEqual(sparse.propIds, ['prop-1']);
  assert.deepEqual(sparse.incidentalObjects, ['普通纸张放在桌上']);
  assert.equal(patchTouchesRefs({ assetPropIds: [] }), true);
});

test('changing only the prop reference subset remaps mentions and keeps approved extras', () => {
  const old: WsShot = { ...shot, assetPropIds: ['prop-1'], imagePrompt: '书房@图片一，姮氏@图片二展开古图@图片三，参考@图片四。' };
  const sparse: WsShot = { ...old, assetPropIds: [] };
  const remapped = remapShotPromptRefs(old, sparse, ctx);
  assert.match(remapped.imagePrompt!, /展开古图/);
  assert.doesNotMatch(remapped.imagePrompt!, /古图@图片三/);
  assert.match(remapped.imagePrompt!, /参考@图片三/);
  assert.deepEqual(buildImageRefBindings(sparse, ctx).filter((ref) => ref.kind === 'extra').map((ref) => ref.path), ['/assets/extra.png']);
});

// Execute the real reference-edit/refresh blocks with in-memory stores; no
// image generation, filesystem mutation or desktop persistence is involved.
function executeReferenceBlock(source: string, globals: Record<string, unknown>) {
  const ts = createRequire(import.meta.url)('typescript');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  runInNewContext(compiled, { exports, ...globals });
  return exports;
}

test('reference refresh preserves explicit sparse and empty prop subsets', async () => {
  const source = readFileSync(new URL('../../stores/workshopStore.ts', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('  refreshShotReferenceBindings: async () => {'), source.indexOf('  updateShotById:', source.indexOf('  refreshShotReferenceBindings: async () => {')));
  for (const subset of [[], ['prop-1']]) {
    let data = { ...ctx, shots: [{ ...shot, description: '古图和普通杯子在桌上', assetPropIds: subset, incidentalObjects: ['普通杯子'], imagePrompt: '角色@图片二看向古图。' }], props: [...ctx.props, { id: 'cup', name: '普通杯子', assetImagePath: '/assets/cup.png' }] };
    let commits = 0;
    const actions = executeReferenceBlock(`const actions = {${block}}; exports.refresh = actions.refreshShotReferenceBindings;`, {
      get: () => ({ data, commitNow: async () => { commits++; } }),
      set: (next: any) => { data = next.data; }, effectiveOpeningCharacterIds,
      remapShotPromptRefs,
    });
    await actions.refresh();
    assert.deepEqual(data.shots[0].assetPropIds, subset);
    assert.deepEqual(data.shots[0].incidentalObjects, ['普通杯子']);
    assert.deepEqual(buildImageRefBindings(data.shots[0], data).filter((ref) => ref.kind === 'prop').map((ref) => ref.id), subset);
    assert.equal(commits, 1);
  }
});

test('reference editing updates the effective subset and does not resurrect excluded props', async () => {
  const source = readFileSync(new URL('../agent/tools/workshopTools.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const updateShotRefsTool: Tool =');
  const block = source.slice(start, source.indexOf('\n/**', start));
  for (const params of [{ remove_prop_ids: ['prop-1'] }, { set_prop_ids: [] }, { add_extra_ref_images: ['/assets/new-extra.png'] }]) {
    const current = { ...shot, propIds: ['prop-1', 'cup'], assetPropIds: ['prop-1'], incidentalObjects: ['普通杯子'], imagePrompt: '展开古图@图片三，参考@图片四。' };
    const data = { ...ctx, shots: [current], props: [...ctx.props, { id: 'cup', name: '普通杯子', assetImagePath: '/assets/cup.png' }] };
    const store = { data, updateShot: (_no: string, patch: object) => Object.assign(current, patch), markStepStatus: () => {}, logChange: () => {}, commitNow: async () => {} };
    const tools = executeReferenceBlock(`${block}\nexports.edit = updateShotRefsTool.execute;`, {
      requireOpen: () => ({ ok: true }), useWorkshopStore: { getState: () => store },
      uniqStrings: (items: any[]) => [...new Set(items.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))],
      invoke: async () => {},
      buildShotRefBindings: buildImageRefBindings, getSceneReferencePaths: () => ['/assets/scene.png'],
      remapPromptRefsForShot: remapShotPromptRefs, verifyShotPatch: () => [], numToCn,
    });
    const result = await tools.edit({ shot_no: shot.shotNo, ...params });
    assert.equal(result.success, true, result.error);
    const ids = buildImageRefBindings(current, data).filter((ref) => ref.kind === 'prop').map((ref) => ref.id);
    if ('add_extra_ref_images' in params) {
      assert.deepEqual(ids, ['prop-1']);
      assert.deepEqual(current.propIds, ['prop-1', 'cup']);
    } else {
      assert.deepEqual(ids, []);
      assert.doesNotMatch(current.imagePrompt, /古图@图片三/);
      assert.match(current.imagePrompt, /展开古图/);
    }
    assert.deepEqual(current.incidentalObjects, ['普通杯子']);
  }
});

test('opening state adds its physical character without dropping an explicit media identity', () => {
  const ids = effectiveOpeningCharacterIds({
    characterIds: ['char-screen'],
    entryState: { location: '出租屋', time: '深夜', characters: '顾念坐在床沿低头整理花枝', props: '花枝', environment: '雨夜' },
  }, [
    { id: 'char-physical', name: '许清晚（化名顾念）', assetImagePath: '/assets/physical.png' },
    { id: 'char-screen', name: '林雨薇', assetImagePath: '/assets/screen.png' },
  ]);
  assert.deepEqual(ids, ['char-screen', 'char-physical']);
});

test('reordering multi-angle scene images follows the image paths', () => {
  const oldCtx: ShotRefsContext = {
    ...ctx,
    scenes: [{
      id: 'scene-1',
      name: '书房',
      selectedImagePaths: ['/assets/scene-wide.png', '/assets/scene-close.png'],
      sceneReferenceMode: 'multi',
    }],
  };
  const nextCtx: ShotRefsContext = {
    ...oldCtx,
    scenes: [{
      id: 'scene-1',
      name: '书房',
      selectedImagePaths: ['/assets/scene-close.png', '/assets/scene-wide.png'],
      sceneReferenceMode: 'multi',
    }],
  };
  const multiShot: WsShot = {
    ...shot,
    imagePrompt: '@图片一提供全景，@图片二提供近景，姮氏参考@图片三。',
  };
  const remapped = remapShotPromptRefs(multiShot, multiShot, oldCtx, nextCtx);

  assert.equal(remapped.imagePrompt, '@图片二提供全景，@图片一提供近景，姮氏参考@图片三。');
});

test('H3 prompt resolution preserves the official skill output without legacy augmentation or asset injection', () => {
  const h3Shot: WsShot = {
    ...shot,
    videoPromptTemplate: 'universal',
    universalVideoPrompt: 'How the reference picture aligns with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video.\n\nintegrated_multimodal_description: [Shot 1] The subject moves forward.\n\noverall_soundscape: room tone.\n\nnon_diegetic_music: none.',
    transitionPlan: {
      kind: 'occlusion',
      trigger: '手掠过镜头',
      target: '信件落地',
      prompt: '遮挡揭示',
    },
  };
  const prompt = videoPromptForShot(h3Shot, ctx, {
    template: 'universal',
    includeStoryboardBoards: false,
    includeDirectorConstraintCard: false,
    skipPlanningAugmentation: true,
  });

  assert.equal(prompt, h3Shot.universalVideoPrompt);
  assert.doesNotMatch(prompt, /【受控转场】|【连续性与生成约束】|@图片|【素材身份】/);
});
