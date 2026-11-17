import type { ShotSpatialStaging, ShotWorldLayer } from './types';

const LAYER_LABEL: Record<ShotWorldLayer, string> = {
  ground: 'ground level',
  elevated: 'elevated platform or raised support',
  aerial: 'aerial / cloud / flight layer',
  'upper-architecture': 'upper architecture',
  'water-surface': 'water surface',
  underwater: 'underwater layer',
  other: 'explicit other support plane',
};

function clean(value: string | undefined): string {
  return String(value ?? '').trim().replace(/\s+/gu, ' ');
}

function isUpperLayer(layer: ShotWorldLayer): boolean {
  return layer === 'elevated' || layer === 'aerial' || layer === 'upper-architecture';
}

function isLowerLayer(layer: ShotWorldLayer): boolean {
  return layer === 'ground' || layer === 'water-surface' || layer === 'underwater';
}

/**
 * Generic directing rule shared by story planning, shot breakdown and H3
 * prompt authoring. Genre is only a signal: the camera decision comes from the
 * dramatic power relationship and the physical support planes in this shot.
 */
export function directorViewpointSelectionRulesZh(): string {
  return [
    '- 先判断本镜谁在戏剧上占上风、谁承受压力，以及这种关系是否已经体现在空间高度或支撑面上，再决定机位；不能只凭“这是神话／都市／爱情”机械选角度。',
    '- 神话、仙侠、玄幻、神权、天庭军队、超自然权威或大规模威胁压向地面人物时，只要高处一方在空间和戏剧权力上占优势，主视角优先使用低机位仰拍或低到高构图：高处力量进入画面上方，地面人物与地形成为下方前景锚点，让观众感到“高高在上”和压迫。平等的同层角色仍应平视：若两位神祇、同层角色平等交谈或并肩行动，则不为题材标签强行仰拍。',
    '- 都市、日常、恋爱、办公、平等对话、信息交换和亲密关系默认使用符合真实视线的平视；机位高度服从人物关系、坐姿/站姿和空间位置，不为了“电影感”随手加仰拍或俯拍。',
    '- 俯拍或高机位只在明确的脆弱、被审视、受审、失败、权力压制或上帝视角需要时使用；它不能只是展示环境的默认总览。若高处力量正压迫地面人物，不要用俯拍把双方压到同一地面。',
    '- 允许镜内混合景别和切镜，但只有上下双方同框时，主构图必须让观众读懂谁在上、谁在下、谁控制空间；特写、反应镜头或局部插入可以短暂聚焦一方，切回关系镜头时不得反转或抹平空间权力关系。',
  ].join('\n');
}

/**
 * Short, model-facing instruction for finished H3 prompts. It is deliberately
 * about the dramatic relationship, not a genre lookup table.
 */
export function directorViewpointExecutionRuleEn(): string {
  return 'VIEWPOINT LOGIC — choose the angle from this shot\'s dramatic power relationship and support planes, not from genre alone. If the planned staging gives an elevated, aerial or supernaturally dominant force power over a grounded subject, use an upward or low-to-high shared frame: grounded subject/terrain anchors the lower frame, the dominant force occupies the upper frame or distant elevated layer, and the height gap remains readable. If the characters are equals on the same plane or it is ordinary conversation, use level framing and preserve true eye-lines. Use downward framing only when the saved dramatic intent makes the lower subject vulnerable, judged, exposed or pressed down. Internal close-ups may vary, but any shared frame must keep the same vertical gap, scale and dominance; camera movement or a legacy camera note must never flatten the upper force onto the lower surface.';
}

/** True when the shot contains a genuine vertical relationship that must remain legible. */
export function hasVerticalSpatialSeparation(staging?: ShotSpatialStaging): boolean {
  if (!staging?.layers?.length) return false;
  const layers = staging.layers.map((entry) => entry.layer);
  return layers.some(isUpperLayer) && layers.some(isLowerLayer);
}

/**
 * Convert planned world layers into a hard, shot-specific directing constraint.
 * This is an instruction for the prompt editor, not finished prose to paste into
 * the final video prompt.
 */
export function buildSpatialStagingDirective(staging?: ShotSpatialStaging): string {
  if (!staging?.layers?.length) return '';
  const layers = staging.layers
    .map((entry) => ({
      subject: clean(entry.subject),
      layer: entry.layer,
      support: clean(entry.support),
      relativeTo: clean(entry.relativeTo),
    }))
    .filter((entry) => entry.subject && entry.support && LAYER_LABEL[entry.layer]);
  if (!layers.length) return '';

  const verticalSeparation = hasVerticalSpatialSeparation(staging);
  const viewpoint = staging.viewpoint;
  const relation = clean(staging.relation);
  const lines: string[] = ['HARD SPATIAL TOPOLOGY (realize this in the final prompt; do not copy this heading or checklist into the output):'];

  for (const entry of layers) {
    lines.push(`- ${entry.subject}: ${LAYER_LABEL[entry.layer]}; support: ${entry.support}${entry.relativeTo ? `; relative position: ${entry.relativeTo}` : ''}.`);
  }
  if (relation) lines.push(`- Planned spatial relation: ${relation}.`);
  if (clean(staging.dramaticIntent)) lines.push(`- Dramatic power relationship: ${clean(staging.dramaticIntent)}.`);
  if (clean(staging.cameraMotivation)) lines.push(`- Camera-choice motivation: ${clean(staging.cameraMotivation)}.`);

  if (viewpoint === 'upward') {
    lines.push('- CAMERA VIEWPOINT: upward. Place the camera physically below the elevated subject/group and above or close to the lower ground plane, tilt upward, and keep the elevated mass in the upper frame while the grounded subject/terrain anchors the lower frame.');
  } else if (viewpoint === 'downward') {
    lines.push('- CAMERA VIEWPOINT: downward. Place the camera above the lower subject/group and look down while preserving the upper layer in depth; do not collapse the two layers into one surface.');
  } else if (viewpoint === 'mixed') {
    lines.push(verticalSeparation
      ? '- CAMERA VIEWPOINT: mixed, with a low-to-high or upward-looking master whenever the upper and lower layers are visible together. Internal coverage may vary, but every shared frame must preserve the vertical gap and screen direction; never use a level or top-down master that makes the elevated force stand on the lower surface.'
      : '- CAMERA VIEWPOINT: mixed. Use each intended view only where it preserves the planned support plane and relative depth; do not infer a new layer from camera movement.');
  } else {
    lines.push('- CAMERA VIEWPOINT: level. Keep the camera at the planned observational height, preserve true eye-line relationships, and do not silently turn a level shot into a high-angle or top-down view that invents dominance or erases support-plane differences.');
  }

  if (verticalSeparation) {
    lines.push('- VERTICAL RELATION: describe the lower subject/terrain as a lower foreground anchor and the higher subject/group as occupying the upper frame or distant elevated layer. Preserve the visible gap and credible scale; do not place both on one ground plane.');
    lines.push('- WORLD-LAYER INVARIANT: pans, tilts, crane moves, focus changes, cuts, speed changes, and camera elevation are viewer-relative only. They must not move a subject between ground, elevated, aerial, architecture, water, or underwater layers. Only an explicit on-screen landing, takeoff, fall, rise, climb, jump, or support transfer in the current action may change a layer, and it must show the connecting path and the new support state.');
  }

  return lines.join('\n');
}

/**
 * Infer the minimum needed spatial topology when an older saved shot has no
 * structured spatialStaging. This does not invent a layer: it only promotes an
 * explicit aerial/cloud/elevated fact already present in the shot text or
 * camera note into the same hard directive used by newly planned shots.
 */
export function inferSpatialStagingFromShotText(input: {
  description?: string;
  atomicAction?: string;
  camera?: string;
  entryState?: { location?: string; environment?: string; characters?: string };
  exitState?: { location?: string; environment?: string; characters?: string };
  /** Project and episode context help distinguish power hierarchy from equal-level conversation. */
  projectGenre?: string;
  storyTone?: string;
  synopsis?: string;
  episodeSynopsis?: string;
  sceneDescription?: string;
}): ShotSpatialStaging | undefined {
  const text = [
    input.description,
    input.atomicAction,
    input.camera,
    input.entryState?.location,
    input.entryState?.environment,
    input.entryState?.characters,
    input.exitState?.location,
    input.exitState?.environment,
    input.exitState?.characters,
  ].filter(Boolean).join(' ');
  if (!text.trim()) return undefined;
  const contextText = [
    input.projectGenre,
    input.storyTone,
    input.synopsis,
    input.episodeSynopsis,
    input.sceneDescription,
  ].filter(Boolean).join(' ');
  const combined = `${text} ${contextText}`;
  const hasAerial = /天兵|天将|云层|云端|云阵|天上|空中|半空|凌霄|天庭|神将|heaven(?:ly)?\s+(?:army|soldier|troop)|aerial|cloud layer|in the sky/i.test(text);
  const hasElevated = /高台|楼台|城楼|上层|屋顶|塔顶|崖顶|云端|云层|空中|半空|elevated|upper (?:platform|architecture)|rooftop|cliff top/i.test(text);
  const hasGround = /地上|地面|山场|码头|站在|落地|\bground(?:ed)?\b|on the (?:ground|rock|floor)|mountain clearing/i.test(text);
  if ((!hasAerial && !hasElevated) || !hasGround) return undefined;
  const explicitUpward = /仰拍|仰望|向上|从下到上|从下往上|low[- ]angle|upward|looking up/i.test(text);
  const explicitDownward = /俯拍|向下|从高处(?:向下|俯看)|高处俯瞰|俯瞰|下压|high[- ]angle|overhead|top[- ]down|looking down/i.test(text);
  const mythicOrSupernatural = /神话|仙侠|玄幻|奇幻|天庭|天兵|天将|神将|神祇|仙界|妖|魔|heaven|divine|deity|celestial|immortal|supernatural/i.test(combined);
  const coerciveAdvance = /压向|压境|围困|围剿|封山|收网|降至|降下|降临|逼近|施压|追捕|拦截|攻击|镇压|天罗地网|descend(?:ing|s)?|advance|surround|threaten|pressure|pursue|attack|siege|loom/i.test(text);
  const dominatingUpperForce = /天兵|天将|军阵|大军|云阵|云层|天庭|神将|神祇|神明|仙尊|神佛|仙佛|巨神|巨龙|舰队|飞行器|army|troops|formation|cloud[- ]borne|aerial|deity|divine|fleet|airship/i.test(text);
  const lowerIndividual = /主角|英雄|独自|单独|一人|站在|立于|守在山场|守卫|守军|地面人物|地面主体|地上的人|哨站|村庄|人群|grounded|stands|standing|a lone|below/i.test(text);
  const equalInteraction = /平等|会谈|商议|议事|对坐|并肩|同席|谈判|交谈|交流|conversation|negotiat|talk|beside|side by side/i.test(text);
  const explicitCoercion = /压向|压境|围困|围剿|封山|收网|降至|降下|降临|逼近|施压|追捕|拦截|攻击|镇压|天罗地网|descend(?:ing|s)?|surround|threaten|pursue|attack|siege|loom/i.test(text);

  // A coercive elevated force facing a grounded subject is the generic visual
  // grammar for domination. Strong scene facts override a legacy camera note
  // such as \"high wide shot pressing down\", which would flatten the hierarchy.
  const coerciveVerticalPower = hasGround
    && (hasAerial || hasElevated)
    && dominatingUpperForce
    && lowerIndividual
    && coerciveAdvance
    && (!equalInteraction || explicitCoercion)
    && (mythicOrSupernatural || hasAerial);
  const upward = explicitUpward || coerciveVerticalPower;
  const downward = !upward && explicitDownward;
  return {
    layers: [
      { subject: 'grounded subject/group', layer: 'ground', support: 'the visible lower ground or terrain anchor' },
      { subject: 'aerial/elevated subject/group', layer: hasAerial ? 'aerial' : 'elevated', support: hasAerial ? 'the visible cloud, sky or flight layer' : 'the visible raised platform or upper architecture', relativeTo: 'above the grounded subject/group' },
    ],
    viewpoint: upward ? 'upward' : downward ? 'downward' : 'mixed',
    relation: 'Keep the grounded subject/group on the lower support plane and the aerial/elevated subject/group above it; preserve the vertical gap and credible scale.',
    dramaticIntent: coerciveVerticalPower
      ? 'The elevated force holds spatial and dramatic dominance over the grounded subject/group; the audience should feel their height, scale and pressure.'
      : 'Preserve the visible vertical relationship between the two support planes without implying unplanned dominance.',
    cameraMotivation: upward
      ? 'The viewpoint is chosen because the elevated force has the spatial/dramatic advantage and the lower subject/terrain should anchor the frame; this is not a genre-wide rule that forces every mythic shot to look up.'
      : downward
        ? 'The downward view is retained only because the legacy shot explicitly frames the lower subject as being observed, judged or made vulnerable from above.'
        : 'Use mixed coverage only when each shot still makes the vertical support relationship readable.',
  };
}

/**
 * Authoring-side checklist for batch/agent prompts. It is intentionally short
 * and points at the structured field instead of guessing from visible height.
 */
export function spatialStagingAuthoringRuleZh(): string {
  return `${directorViewpointSelectionRulesZh()}
- 每镜写入 videoPrompt 前必须读取该镜 spatialStaging；只要存在高度的上下分层（例如地面主体面对云层、空中或高台群体），最终提示词必须写出低处主体的下方/前景支撑与高处主体的上方/远景层级，并在 [CAMERA_LOGIC] 体现该镜规划指定的仰拍、平视、俯拍或混合关系。不要只写“宏大”，也不要用平视或俯拍把两层压到同一地面。镜头升降只改变观众视点，不改变人物所在世界层。只有当前动作明确发生落地、起飞、坠落、飞升、攀爬或支撑面转移时，才允许跨层并写出连续路径。`;
}
