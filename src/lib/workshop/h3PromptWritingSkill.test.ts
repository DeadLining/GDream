import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  H3_PROMPT_WRITING_BASE_GUIDE,
  H3_PROMPT_WRITING_REF_GUIDE,
  H3_PROMPT_WRITING_SKILL,
  h3PromptWritingSkillForTask,
} from './h3PromptWritingSkill.ts';
import { H3_REF2VA_SKILL } from './h3Ref2vaPrompt.ts';
import { REF2VA_GUIDE } from './h3Ref2vaSkillContent.ts';

test('the default production path is Layer 1 plan then Layer 2 normalization', () => {
  assert.match(H3_PROMPT_WRITING_SKILL, /two layers that form one default production pipeline/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /Layer 1 first and persist its action timeline before Layer 2/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /3–5 meaningful primary beats/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /already-authoritative action plan/i);
});

test('bundles the complete h3-prompt-writing skill instead of a summary', () => {
  assert.match(H3_PROMPT_WRITING_SKILL, /## Two-Layer Operation/);
  assert.match(H3_PROMPT_WRITING_SKILL, /### Layer 1: Script-to-Action Planning/);
  assert.match(H3_PROMPT_WRITING_SKILL, /### Layer 2: Video-Prompt Normalization/);
  assert.match(H3_PROMPT_WRITING_SKILL, /## Physical-Action-First Planning/);
  assert.match(H3_PROMPT_WRITING_SKILL, /## Timeline Validation/);
});

test('base keyframe modes receive the complete base guide at runtime', () => {
  const prompt = h3PromptWritingSkillForTask('i2va');
  assert.match(prompt, /## Complete Base Mode Guide/);
  assert.ok(prompt.includes(H3_PROMPT_WRITING_BASE_GUIDE));
  assert.match(H3_PROMPT_WRITING_BASE_GUIDE, /### 4\.8 Physical Action and Timeline Planning/);
  assert.match(H3_PROMPT_WRITING_BASE_GUIDE, /starting state -> visible action -> physical connection or motion path -> ending state/);
});

test('full-reference mode receives the complete Codex h3-prompt-writing skill and guide at runtime', () => {
  const prompt = h3PromptWritingSkillForTask('ref2va');
  assert.match(prompt, /# H3 Prompt Writing/);
  assert.match(prompt, /## Full-Reference Mode/);
  assert.match(prompt, /Read `references\/ref-en.txt`/);
  assert.match(prompt, /## Complete Reference Mode Guide/);
  assert.ok(prompt.includes(H3_REF2VA_SKILL));
  assert.match(H3_REF2VA_SKILL, /Full-Reference Mode Prompt Writing Guide/);
  assert.match(H3_REF2VA_SKILL, /subject_definitions/);
  assert.match(H3_REF2VA_SKILL, /retention_analysis/);
});

test('runtime skill text stays byte-identical to the checked-in source files', () => {
  const root = process.cwd();
  assert.equal(
    H3_PROMPT_WRITING_SKILL,
    readFileSync(join(root, 'skills/h3-prompt-writing/SKILL.md'), 'utf8'),
  );
  assert.equal(
    H3_PROMPT_WRITING_BASE_GUIDE,
    readFileSync(join(root, 'skills/h3-prompt-writing/references/base-en.txt'), 'utf8'),
  );
  assert.equal(
    H3_PROMPT_WRITING_REF_GUIDE,
    readFileSync(join(root, 'skills/h3-prompt-writing/references/ref-en.txt'), 'utf8'),
  );
});

test('all runtime modes receive event-led, adaptive-density writing rather than fixed template padding', () => {
  for (const task of ['i2va', 'fl2va', 't2va', 'ref2va'] as const) {
    const skill = h3PromptWritingSkillForTask(task);
    assert.match(skill, /cause.*action|cause,.*contact/is);
    assert.match(skill, /listener|listening/i);
    assert.match(skill, /medium.*material/is);
    assert.match(skill, /natural paragraphs|Natural\s+paragraphs/i);
    assert.match(skill, /complexity.*(?:quota|character)|character.*complexity/is);
  }
});

test('normalization preserves planned cuts, expressions and speech instead of forcing a silent continuous take', () => {
  for (const task of ['i2va', 'fl2va', 't2va'] as const) {
    const prompt = h3PromptWritingSkillForTask(task);
    assert.match(prompt, /本次最终提示词采用 Layer 2/);
    assert.match(prompt, /不把 Physical-Action-First 误解成只写肢体动作/);
    assert.match(prompt, /原有切镜按指南 Shots and Cuts 写明/);
    assert.match(prompt, /I2VA 只锁开场状态，不自动等于一镜到底/);
  }
});

test('every H3 mode receives genre-neutral expression permissions with factual boundaries', () => {
  for (const task of ['i2va', 'fl2va', 't2va'] as const) {
    const prompt = h3PromptWritingSkillForTask(task);
    assert.match(prompt, /WORKSHOP EXPRESSION POLICY/);
    assert.match(prompt, /An unspecified performance detail is not a command to remain still/);
    assert.match(prompt, /Keep established events, exact dialogue/);
    assert.match(prompt, /Do not impose comedy timing, suspense, stillness, or exaggerated acting on every genre/);
    assert.match(prompt, /Explicit camera instructions take priority/);
    assert.match(prompt, /Missing camera detail is permission to design coverage/);
    assert.match(prompt, /a push-in is not the default/);
    assert.doesNotMatch(prompt, /若缺少必要的摄影规划，应先在规划阶段明确/);
  }
});

test('dialogues resolve aliases and forms of address to one existing subject', () => {
  for (const task of ['i2va', 'fl2va', 't2va'] as const) {
    const prompt = h3PromptWritingSkillForTask(task);
    assert.match(prompt, /ONE PERSON, ONE IDENTITY/);
    assert.match(prompt, /courtesy name or style name, title, rank, kinship term, pronoun, and any form of address/);
    assert.match(prompt, /never create a second visible person, speaker, listener, mouth, voice, or body from an alias/);
    assert.match(prompt, /bind each dialogue line to that same identity and stable \(Sx\) ID/);
    assert.match(prompt, /report ambiguity instead of adding a person/);
  }
});

test('all authoring modes receive in-event dialogue placement without requiring fixed sections', () => {
  for (const task of ['i2va', 'fl2va', 't2va', 'ref2va'] as const) {
    const prompt = h3PromptWritingSkillForTask(task).replace(/\s+/gu, ' ');
    assert.match(prompt, /chronological (?:action|event) passage/);
    assert.match(prompt, /(?:approximate time|sequence cue)/);
    assert.match(prompt, /(?:one stable voice ID for one physical speaker|Never reuse one voice ID for two physical speakers)/);
    assert.match(prompt, /same already-present person/);
    assert.match(prompt, /question counts and handoffs/);
  }
});

test('canonical character facts expose exactly the physical cast to the rewriter', async () => {
  const { buildShotRewriteFacts } = await import('./shotRewriteContext.ts');
  const shot = {
    id: 's1',
    shotNo: '01-01',
    sceneId: 'tent',
    characterIds: ['lu-su', 'zhuge-liang', 'zhou-yu'],
    propIds: [],
    dialogue: '鲁肃：都督既命我相助。\n周瑜：子敬可以帮他筹备。',
    actionTimeline: { durationSec: 9, summary: '', segments: [] },
    entryState: { characters: '鲁肃、诸葛亮、周瑜在场', props: '', location: '军帐', time: '白天', environment: '' },
    exitState: { characters: '鲁肃、诸葛亮、周瑜在场', props: '', location: '军帐', time: '白天', environment: '' },
  } as any;
  const data = {
    projectId: 'p1',
    shots: [shot],
    episodes: [],
    scenes: [{ id: 'tent', name: '军帐', description: '议事帐' }],
    props: [],
    characters: [
      { id: 'lu-su', name: '鲁肃', personality: '', appearance: '' },
      { id: 'zhuge-liang', name: '诸葛亮', personality: '', appearance: '' },
      { id: 'zhou-yu', name: '周瑜', personality: '', appearance: '' },
    ],
  } as any;
  const facts = buildShotRewriteFacts(data, shot);
  assert.match(facts, /"id":"lu-su","name":"鲁肃"/);
  assert.match(facts, /"id":"zhuge-liang","name":"诸葛亮"/);
  assert.match(facts, /"id":"zhou-yu","name":"周瑜"/);
  assert.match(facts, /Dialogue identity map \(mandatory\)/);
  assert.match(facts, /"speakerLabel":"鲁肃"[^}]*"canonicalName":"鲁肃"[^}]*"stableId":"S1"/);
  assert.match(facts, /"speakerLabel":"周瑜"[^}]*"canonicalName":"周瑜"[^}]*"stableId":"S3"/);
  assert.doesNotMatch(facts, /"name":"子敬"|"name":"孔明"/);
});

test('same-scene rewrite facts retain structured exit state without recycling generated prose', async () => {
  const { buildShotRewriteFacts } = await import('./shotRewriteContext.ts');
  const previous = {
    id: 'previous',
    shotNo: '01-01',
    sceneId: 'mountain',
    characterIds: ['sun-wukong'],
    description: 'Sun Wukong stands on the rocky ground with the cudgel across his shoulder.',
    atomicAction: 'He plants the cudgel and orders the troop to retreat.',
    spatialStaging: { layers: [{ subject: 'Sun Wukong', layer: 'ground', support: 'rocky ground' }], viewpoint: 'level', relation: 'He remains on the lower ground plane.' },
    exitState: { location: 'rocky ground', characters: 'Sun Wukong standing on the ground', props: 'cudgel in hand', environment: 'daylight' },
    universalVideoPrompt: 'The previous shot ends with Sun Wukong grounded beside the waterfall.',
  } as any;
  const current = {
    id: 'current',
    shotNo: '01-02',
    sceneId: 'mountain',
    episode: '01',
    characterIds: ['sun-wukong'],
    description: 'Sun Wukong turns toward the approaching army.',
    spatialStaging: { layers: [{ subject: 'Sun Wukong', layer: 'ground', support: 'rocky ground' }, { subject: 'approaching army', layer: 'aerial', support: 'cloud layer', relativeTo: 'above Sun Wukong' }], viewpoint: 'mixed', relation: 'The army stays above while Sun Wukong remains grounded.' },
    entryState: { location: 'rocky ground', characters: 'Sun Wukong standing on the ground', props: 'cudgel in hand', environment: 'daylight' },
  } as any;
  const facts = buildShotRewriteFacts({ episodes: [], scenes: [{ id: 'mountain', name: 'Flower Fruit Mountain', description: 'mountain' }], props: [], characters: [], bibles: {}, style: {} } as any, current, previous);
  assert.match(facts, /Previous same-scene shot continuity context/);
  assert.doesNotMatch(facts, /grounded beside the waterfall/);
  assert.match(facts, /"exitState":\{"location":"rocky ground"/);
  assert.doesNotMatch(facts, /The previous shot ends/);
  assert.match(facts, /"layer":"aerial","support":"cloud layer","relativeTo":"above Sun Wukong"/);
  assert.match(facts, /carry that physical state forward/);
  // The predecessor's parallel prose restatements never reach the rewriter, so
  // the model has exactly one copy of the completed action to continue from.
  assert.doesNotMatch(facts, /Sun Wukong stands on the rocky ground with the cudgel across his shoulder/);
  assert.doesNotMatch(facts, /He plants the cudgel and orders the troop to retreat/);
});

test('parallel restatements of the action are not fed to the rewriter twice', async () => {
  const { buildShotRewriteFacts } = await import('./shotRewriteContext.ts');
  const phrase = '佐助从裂缝坠落单膝砸地';
  const shot = {
    id: 's1', shotNo: '01-01', episode: '01', sceneId: 'rift',
    characterIds: [], propIds: [],
    description: phrase,
    atomicAction: phrase,
    sourceExcerpt: phrase,
    camera: '低机位', shotType: '远景', mood: '压迫',
    actionTimeline: { durationSec: 6, summary: phrase, segments: [{ startSec: 0, endSec: 6, track: 'body', label: phrase }] },
    entryState: { characters: phrase }, exitState: { characters: phrase },
  } as any;
  const data = {
    shots: [shot], episodes: [], characters: [], props: [],
    scenes: [{ id: 'rift', name: '裂谷荒原', description: '荒原' }],
    bibles: {}, style: {},
  } as any;
  const facts = buildShotRewriteFacts(data, shot);
  // The timeline is the single action source; the parallel prose restatements
  // must not be present as separate sections the model would also translate.
  assert.equal(facts.includes('AUTHORITATIVE ACTION AND TIMING'), false);
  assert.match(facts, /ACTION SEQUENCE/);
  assert.match(facts, /OPENING STATE/);
  assert.match(facts, /CLOSING STATE/);
  assert.equal(facts.includes('Canonical shot state and action facts'), false);
});

test('director intent is stated first and before the generic writing guidance', async () => {
  const { buildShotRewriteFacts } = await import('./shotRewriteContext.ts');
  const shot = {
    id: 's1', shotNo: '01-01', episode: '01', sceneId: 'rift',
    characterIds: [], propIds: [],
    camera: '从褶皱下摇跟落，再低机位仰摇带出断碑顶端的神将',
    shotType: '远景', mood: '压迫',
    spatialStaging: { viewpoint: 'upward', cameraMotivation: '用仰角把高位神将压向观众' },
    actionTimeline: { durationSec: 6, summary: 't', segments: [] },
    entryState: {}, exitState: {},
  } as any;
  const data = {
    shots: [shot], episodes: [], characters: [], props: [],
    scenes: [{ id: 'rift', name: '裂谷荒原', description: '荒原' }],
    bibles: {}, style: {},
  } as any;
  const facts = buildShotRewriteFacts(data, shot);

  // The shot's own camera design must arrive before any generic guidance so it
  // is not diluted among equally weighted id fields.
  const intentAt = facts.indexOf('DIRECTOR INTENT FOR THIS SHOT');
  const actionAt = facts.indexOf('ACTION SEQUENCE');
  assert.ok(intentAt >= 0, 'director intent section missing');
  assert.ok(intentAt < actionAt, 'director intent must precede the action block');
  assert.match(facts, /realize these exactly; they are the shot design, not suggestions/);
  assert.match(facts, /从褶皱下摇跟落，再低机位仰摇带出断碑顶端的神将/);
  assert.match(facts, /"viewpoint":"upward"/);
  assert.doesNotMatch(facts.split('ACTION SEQUENCE')[0], /"screenCharacterIds"/);
  // The legacy prompt travels in its own dedicated request section; facts must
  // not echo it or the writer receives the same text twice.
  assert.doesNotMatch(facts, /lowest-priority legacy text/);
});

test('timing follows events and dialogue instead of equal blocks or segment quotas', () => {
  const prompt = h3PromptWritingSkillForTask('i2va');
  assert.match(prompt, /not a fixed two-second grid, a minimum interval, or a target number of segments/);
  assert.match(prompt, /a dialogue emphasis, a pause, or a listener's reaction/);
  assert.match(prompt, /Timeline subdivision does not imply a camera cut/);
  assert.match(prompt, /Speech, listening, movement, and ambience may overlap naturally/);
});

test('opening is definite without fabricating unseen frame details', () => {
  const prompt = h3PromptWritingSkillForTask('i2va');
  assert.match(prompt, /an image path or reference label alone is not evidence/);
  assert.match(prompt, /one executable continuation/);
  assert.match(prompt, /Do not invent certainty to remove a conditional/);
  assert.match(prompt, /A first frame constrains the opening instant, not all later poses/);
  assert.match(prompt, /T2VA and Ref2VA do not inherit an invented first-frame restriction/);
});

test('writer no longer counteracts directing permissions with blanket motion and camera bans', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/workshop/workshopPrompts.ts'), 'utf8');
  assert.doesNotMatch(source, /If the facts do not establish a movement, do not invent one/);
  assert.doesNotMatch(source, /Camera movement and framing changes must come from the approved camera facts/);
  assert.doesNotMatch(source, /没有明确运镜时，保持稳定、可执行的连续覆盖/);
  assert.match(source, /Natural performance and motivated coverage/);
  assert.match(source, /Resolve the opening into one factual continuation/);
});

test('only I2VA boundaries favor an inheritable master while allowing internal close-ups', () => {
  const i2va = h3PromptWritingSkillForTask('i2va');
  assert.match(i2va, /I2VA INHERITANCE BOUNDARY COMPOSITION/);
  assert.match(i2va, /open and end on an inheritable medium framing/);
  assert.match(i2va, /Close-ups, inserts, reaction shots, motivated cuts, and tighter framing are allowed inside the shot/);
  assert.match(i2va, /Return to an inheritable medium framing or another suitable spatial master/);
  assert.match(i2va, /Do not default to a very large or distant environmental wide shot/);
  assert.match(i2va, /Do not end on an isolated hand, eye, partial face, small prop detail/);
  assert.match(i2va, /this return rule overrides any legacy internal-coverage instruction that holds a close-up through the end/);

  for (const task of ['fl2va', 't2va', 'ref2va'] as const) {
    assert.doesNotMatch(h3PromptWritingSkillForTask(task), /I2VA INHERITANCE BOUNDARY COMPOSITION/);
  }
});

test('rewrite facts include character bible rules and readable blocking continuity', async () => {
  const { buildShotRewriteFacts } = await import('./shotRewriteContext.ts');
  const data = {
    episodes: [], narrativeBeats: [],
    characters: [
      { id: 'erlangshen', name: '二郎神（杨戬）', appearance: '银冠玄甲', personality: '沉稳' },
      { id: 'sasuke', name: '宇智波佐助', appearance: '深色忍服', personality: '冷傲' },
    ],
    scenes: [{ id: 'rift', name: '裂谷荒原', description: '荒原' }],
    props: [],
    bibles: {
      character: { rules: [
        { characterId: 'erlangshen', lockedAppearance: '天眼闭合时是一道竖线。', costumeRules: ['银冠玄甲不换装'] },
        { characterId: 'sasuke', lockedAppearance: '右臂绷带与烧穿袖口单向递进。', costumeRules: [] },
      ], globalRules: ['人物身高体型关系固定。'], updatedAt: 1 },
      continuity: { blockingContinuity: [{ scene: '裂谷荒原', anchor: '断碑', axis: '南北向', exits: '碑林方向', state: '二郎神在断碑上，佐助在地面。' }], lockedItems: [], referenceOrderRules: [], costumeContinuity: [], propContinuity: [], lightingContinuity: [], editContinuity: [], updatedAt: 1 },
    },
    style: {},
  } as any;
  const shot = { id: 's1', shotNo: '01-01', sceneId: 'rift', characterIds: ['erlangshen', 'sasuke'], propIds: [] } as any;
  const facts = buildShotRewriteFacts(data, shot);
  assert.match(facts, /Canonical character bible records/);
  assert.match(facts, /天眼闭合时是一道竖线/);
  assert.match(facts, /银冠玄甲不换装/);
  assert.match(facts, /Project-wide character bible rules: 人物身高体型关系固定/);
  assert.match(facts, /scene=裂谷荒原 \| anchor=断碑 \| axis=南北向 \| exits=碑林方向 \| state=二郎神在断碑上/);
  assert.doesNotMatch(facts, /\[object Object\]/);
});

test('both H3 routes separate persistent identity from mutable object states', () => {
  for (const task of ['i2va', 'ref2va'] as const) {
    const skill = h3PromptWritingSkillForTask(task);
    assert.match(skill, /Identity is not state/);
    assert.match(skill, /state_ledger/);
    assert.match(skill, /until a visible, motivated action changes it/);
    assert.match(skill, /same pair remains in the right hand/);
    assert.match(skill, /Repair the conflicting preservation sentence/);
    assert.match(skill, /This is a writing check, not proof that the generated video is correct/);
  }
});

test('Ref2VA retention describes scoped properties, not frozen accessory poses', () => {
  assert.match(REF2VA_GUIDE, /fully_preserved.*does not mean every pictured state lasts throughout the clip/);
  assert.match(REF2VA_GUIDE, /removed glasses remain the same object/);
});

test('all H3 modes receive general cross-section ambiguity resolution', () => {
  for (const task of ['t2va', 'i2va', 'fl2va', 'ref2va'] as const) {
    const skill = h3PromptWritingSkillForTask(task);
    assert.match(skill, /## Cross-section ambiguity resolution/);
    assert.match(skill, /entity, property, time interval, reference role and evidence/);
    assert.match(skill, /Do not mix stable properties and mutable states in one blanket preservation claim/);
    assert.match(skill, /key light versus sole light source/);
    assert.match(skill, /camera translation versus pan\/tilt/);
    assert.match(skill, /Rewrite or remove the conflicting source sentence/);
    assert.match(skill, /A preservation marker alone does not resolve a contradiction/);
    assert.match(skill, /Keep this audit internal/);
  }
});

test('Ref2VA guide rejects blanket retention with a later exception', () => {
  assert.match(REF2VA_GUIDE, /Do not use a blanket preservation claim followed by an exception/);
});

test('every H3 route audits visibility without silently changing approved coverage', () => {
  for (const task of ['t2va', 'i2va', 'fl2va', 'ref2va'] as const) {
    const skill = h3PromptWritingSkillForTask(task);
    assert.match(skill, /## Viewpoint and visibility contract/);
    assert.match(skill, /camera position -> subject orientation -> visible surfaces -> occlusion -> readable detail/);
    assert.match(skill, /Story facts are not automatically visible frame content/);
    assert.match(skill, /Do not invent a cut, reverse angle, transparent surface or object rotation/);
    assert.match(skill, /reference subject from the presentation of its reference image/);
    assert.match(skill, /If a reference is explicitly assigned a layout or composition role/);
  }
});

test('Ref2VA format guide applies visibility to the whole prompt, not only first appearances', () => {
  assert.match(REF2VA_GUIDE, /Apply the viewpoint and visibility contract across all six sections/);
  assert.match(REF2VA_GUIDE, /a rear-facing display does not expose its interface to the camera/);
});

test('H3 skill uses a flexible director process layer instead of a fixed prose template', () => {
  assert.match(H3_PROMPT_WRITING_SKILL, /Director Process Layer/);
  assert.match(H3_PROMPT_WRITING_SKILL, /cause -> physical action -> contact or path -> visible consequence -> resulting state/i);
  assert.ok(H3_PROMPT_WRITING_SKILL.includes('Choose camera placement and movement from the information the viewer must see'));
  assert.ok(H3_PROMPT_WRITING_SKILL.includes('Music is optional'));
});

test('H3 skill keeps director reasoning internal and requires compact final prompts', () => {
  assert.match(H3_PROMPT_WRITING_SKILL, /Keep the director process internal/);
  assert.match(H3_PROMPT_WRITING_SKILL, /Do not repeat stable identity or global style in every beat/);
  assert.match(H3_PROMPT_WRITING_SKILL, /summary.*1-2 sentences|one or two sentences/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /music.*N\/A|music is optional/i);
});

test('compact H3 output has an explicit density contract', () => {
  assert.match(H3_PROMPT_WRITING_SKILL, /300-700 words|compact production brief/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /one canonical mention|one concise mention/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /Do not copy the state ledger into the final prompt/i);
});

test('H3 skill models character relationships as visible interaction chains', () => {
  assert.match(H3_PROMPT_WRITING_SKILL, /initiative.*target cue.*response.*consequence/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /Do not describe relationship with adjectives alone/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /speaker.*listener.*visible response/i);
});

test('H3 skill defines a single priority order for conflicting prompt requirements', () => {
  assert.match(H3_PROMPT_WRITING_SKILL, /Prompt Priority Order/);
  assert.match(H3_PROMPT_WRITING_SKILL, /approved facts.*dialogue.*continuity/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /action and interaction/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /style adjectives.*lowest/i);
});

test('H3 final prompts use declarative continuity instead of uncertain handoff language', () => {
  assert.match(H3_PROMPT_WRITING_SKILL, /continuity.*declarative|declarative.*continuity/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /Do not use.*may|can reference|if available|尽量|可能/iu);
  assert.match(H3_PROMPT_WRITING_SKILL, /opening state.*must|must begin/i);
});

test('H3 skill separates creative prose from interface wrapping', () => {
  assert.match(H3_PROMPT_WRITING_SKILL, /Creative Core.*Interface Wrapper/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /write the action prose first/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /Do not put analysis.*final prompt|Do not put.*analysis.*prompt/i);
  assert.match(H3_PROMPT_WRITING_SKILL, /show the result through visible action/i);
});
