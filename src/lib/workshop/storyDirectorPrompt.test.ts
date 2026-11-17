import { readFileSync } from 'node:fs';
import { buildIdeaStoryPlanningPrompt } from './storyDirectorPrompt.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEpisodeScreenplayPrompt,
  buildStoryDirectorPrompt,
  SCREENPLAY_DIALOGUE_DENSITY_RULES,
  STORY_DIRECTOR_CONTINUITY_RULES,
  STORY_DIRECTOR_CORE_RULES,
  STORY_DIRECTOR_DELIVERY_CONTRACT,
  STORY_DIRECTOR_REPORT_SAFETY,
} from './storyDirectorPrompt.ts';
import { buildScriptReviewPrompt } from './workshopPrompts.ts';

test('shared Story Director prompt contains the atomic shot contract', () => {
  const prompt = buildStoryDirectorPrompt('一个孩子在雨夜寻找回家的路');
  assert.match(prompt, /Scene → Narrative Beat → Atomic Shot/);
  assert.match(prompt, /continuityMode="inherit"/);
  assert.match(prompt, /entryState/);
  assert.match(prompt, /exitState/);
  assert.match(prompt, /一条主叙事线/);
  assert.match(prompt, /受控转场镜头/);
  assert.match(prompt, /transitionPlan/);
  assert.match(prompt, /每镜最多一次/);
  assert.match(prompt, /一个孩子在雨夜寻找回家的路/);
});

test('shared Story Director prompt plans world layers before framing and camera work', () => {
  const prompt = buildStoryDirectorPrompt('一场高空飞船与地面哨站的交锋');

  assert.match(prompt, /spatialStaging 在 shotType\/camera 之前完成/);
  assert.match(prompt, /ground\/elevated\/aerial\/upper-architecture\/water-surface\/underwater\/other/);
  assert.match(prompt, /可见支撑条件/);
  assert.match(prompt, /相对另一主体的上下关系/);
  assert.match(prompt, /镜头运动是观众视点，不是世界位移/);
  assert.match(prompt, /从一处支撑面转移到另一处/);
  assert.match(prompt, /先判断本镜谁在戏剧上占上风/);
  assert.match(prompt, /神话、仙侠、玄幻、神权、天庭军队、超自然权威/);
  assert.match(prompt, /平等的同层角色仍应平视/);
  assert.match(prompt, /dramaticIntent/);
  assert.match(prompt, /cameraMotivation/);
  assert.doesNotMatch(prompt, /天兵|守军/);
});

test('built-in skill can use the placeholder without losing shared rules', () => {
  const prompt = buildStoryDirectorPrompt('{{userContent}}');
  assert.ok(prompt.includes(STORY_DIRECTOR_CORE_RULES));
  assert.ok(prompt.endsWith('用户输入：\n{{userContent}}'));
  assert.ok(prompt.includes(STORY_DIRECTOR_CONTINUITY_RULES));
});

test('shared Story Director prompt makes the script a scene and beat source of truth', () => {
  const prompt = buildStoryDirectorPrompt('一个人在雨夜寻找失踪的猫');
  assert.match(prompt, /剧本定稿是整个生产链的上游事实源/);
  assert.match(prompt, /每个 Scene 只有一个地点、连续时间/);
  assert.match(prompt, /每个 Scene 由若干 Narrative Beat 组成/);
  assert.match(prompt, /稳定的 Markdown 结构/);
  assert.match(prompt, /执行顺序必须固定为/);
  assert.match(prompt, /主要触发事件尽早出现/);
  assert.match(prompt, /任何“然后、同时、随后切到/);
});

test('shared Story Director prompt includes creative directing quality checks', () => {
  const prompt = buildStoryDirectorPrompt('一个人在雨夜寻找失踪的猫');
  assert.match(prompt, /Hook/);
  assert.match(prompt, /信息递进/);
  assert.match(prompt, /升级与落点/);
  assert.match(prompt, /镜头密度/);
  assert.match(prompt, /声音意图/);
  assert.match(prompt, /镜头密度与时长分配/);
  assert.match(prompt, /先按剧情权重把总时长分给各段落/);
  assert.match(prompt, /H3 为 15 秒/);
  assert.doesNotMatch(prompt, /完整的单一连续动作可以保留为 4-7 秒镜头/);
});

test('shared Story Director prompt includes cross-episode and minimal-repair rules', () => {
  const prompt = buildStoryDirectorPrompt();
  assert.match(prompt, /sourceEpisode、targetEpisode、inheritedState、intendedChange/);
  assert.match(prompt, /最小 Scene\/Beat\/Shot 范围/);
  assert.match(prompt, /accepted review/);
  assert.match(prompt, /禁止盲目重复提交/);
});

test('story development prompt carries short-drama positioning and episode architecture', () => {
  const prompt = buildStoryDirectorPrompt('一个被误解的厨师为女儿查明真相', {
    format: 'short-series',
    episodeCount: 60,
    episodeDurationSec: 90,
    detailLevel: 'detailed',
    expansionPolicy: 'balanced',
    allowNewCharacters: true,
    allowSubplots: true,
    allowNewConflicts: true,
    genre: '都市悬疑',
    audience: '女频',
    tone: '压抑后爽燃',
    endingType: '大团圆',
    outputLanguage: 'zh-CN',
  });
  assert.match(prompt, /都市悬疑/);
  assert.match(prompt, /女频/);
  assert.match(prompt, /60 集/);
  assert.match(prompt, /开场钩子、当集目标、冲突升级/);
  assert.match(prompt, /付费卡点、爽点、反转和悬念/);
  assert.match(prompt, /不得把一个 Idea 直接压缩成一集短梗概/);
});

test('story format switches between fast short-drama and slow-drama rules', () => {
  const fast = buildStoryDirectorPrompt('一个被误解的厨师为女儿查明真相', {
    format: 'short-series', episodeCount: 12, episodeDurationSec: 90, detailLevel: 'detailed',
    expansionPolicy: 'balanced', allowNewCharacters: true, allowSubplots: false, allowNewConflicts: true,
  });
  const slow = buildStoryDirectorPrompt('一对母女重新理解彼此', {
    format: 'slow-drama', episodeCount: 6, episodeDurationSec: 600, detailLevel: 'detailed',
    expansionPolicy: 'balanced', allowNewCharacters: false, allowSubplots: false, allowNewConflicts: false,
  });
  assert.match(fast, /作品形式：多集短剧/);
  assert.match(fast, /多集短剧节奏规则/);
  assert.match(fast, /对白可以更密、更直接/);
  assert.match(slow, /作品形式：慢剧/);
  assert.match(slow, /慢剧节奏规则/);
  assert.match(slow, /保留观察、停顿、犹豫、沉默/);
  assert.doesNotMatch(slow, /爽点、反转和悬念必须/);
});

test('episode screenplay prompt requires a complete playable script', () => {
  const prompt = buildEpisodeScreenplayPrompt({
    idea: '一个被误解的厨师为女儿查明真相',
    episodeNo: '03',
    title: '厨房里的证据',
    synopsis: '男主发现关键线索，却被店长阻拦。',
    openingState: '男主在后厨清点食材。',
    centralConflict: '店长要求他交出账本。',
    climax: '账本夹层露出关键照片。',
    cliffhanger: '照片背面写着女儿的名字。',
    endingState: '男主带着照片离开后厨。',
    format: 'short-series',
    episodeDurationSec: 90,
    detailLevel: 'detailed',
    expansionPolicy: 'balanced',
    genre: '都市悬疑',
    audience: '女频',
    tone: '压抑后爽燃',
    endingType: '大团圆',
    outputLanguage: 'zh-CN',
  });
  assert.match(prompt, /作品形式：多集短剧/);
  assert.match(prompt, /多集短剧节奏规则/);
  assert.match(prompt, /本集目标与情绪曲线/);
  assert.match(prompt, /人物目标与阻力/);
  assert.match(prompt, /完整剧本正文/);
  assert.match(prompt, /不要只输出分镜摘要/);
  assert.match(prompt, /照片背面写着女儿的名字/);
});

test('script review prompt is read-only and checks shot-ready structure', () => {
  const prompt = buildScriptReviewPrompt();
  assert.match(prompt, /只读结构审核/);
  assert.match(prompt, /不要调用任何生成图片、音频或视频工具/);
  assert.match(prompt, /Scene → Narrative Beat → Atomic Shot/);
  assert.match(prompt, /H3 为 15 秒/);
  assert.match(prompt, /时长分配是否按剧情权重形成长短对比/);
  assert.match(prompt, /不要把每句对白和每个微动作机械拆镜/);
  assert.match(prompt, /不要调用 workshop_set_breakdown 或 workshop_set_shots/);
});

test('汇报安全：对话回复只写摘要，但正文与工具参数保持忠实', () => {
  const prompt = buildStoryDirectorPrompt('一个现代青年重生为灰鼠的故事', {
    format: 'short-series',
    episodeCount: 2,
    episodeDurationSec: 90,
    detailLevel: 'detailed',
    expansionPolicy: 'balanced',
    allowNewCharacters: true,
    allowSubplots: true,
    allowNewConflicts: true,
  });
  // 该段必须真的进了提示词
  assert.ok(prompt.includes(STORY_DIRECTOR_REPORT_SAFETY));
  assert.match(prompt, /汇报安全（对话回复 ≠ 交付物，两者要求相反）/);
  assert.match(prompt, /不要逐字复述对白原文/);
  assert.match(prompt, /对话回复只写中性摘要/);
  // 关键区分：不能为了规避审核把正文一起改掉——否则会赔上创作质量
  assert.match(prompt, /必须忠实完整，不要为了规避审核删改剧情事实/);
  // 遇到截断占位符时的处置
  assert.match(prompt, /内容存在敏感信息/);
  assert.match(prompt, /不要重发同一段文字/);
  assert.match(prompt, /落库本身已完成/);
});

test('回归锁：汇报安全段只约束对话回复，不得约束剧本正文', () => {
  // 事故是上游「输出侧」审核掐断了末轮总结（gateway-1789613006116-1348，
  // output_tokens=19、正文 198 字符、引号未闭合），落库的 7 次工具调用本身是成功的。
  // 因此修复必须落在「怎么说」，不能落在「写什么」。
  const section = STORY_DIRECTOR_REPORT_SAFETY;
  assert.match(section, /对话回复/, '必须限定作用域为对话回复');
  assert.doesNotMatch(
    section,
    /禁止写入|不要写入|删除剧情|改写剧情/,
    '不得出现会诱导删改剧本正文的措辞',
  );
});

test('共享提示词里同时存在汇报安全段与交付契约', () => {
  const prompt = buildStoryDirectorPrompt();
  assert.ok(prompt.includes(STORY_DIRECTOR_DELIVERY_CONTRACT), '交付契约不能丢');
  assert.ok(prompt.includes(STORY_DIRECTOR_REPORT_SAFETY), '汇报安全段不能丢');
  // 交付契约要求「落库」，汇报安全要求「回复只概括」——两者都得在，缺一会退回原缺陷
  assert.match(prompt, /未落库等于未交付/);
});

test('director plans dialogue, listener reactions and varied framing without overriding deliberate silence', () => {
  const prompt = buildStoryDirectorPrompt('一场父女重逢');
  assert.match(prompt, /不默认沉默开场，不默认全员克制，不默认每镜慢推/);
  assert.match(prompt, /不强制每个人说话/);
  assert.match(prompt, /说话人写诉求、语气、重音/);
  assert.match(prompt, /听者写听到哪句话/);
  assert.match(prompt, /关系全景、双人中景、过肩、正反打、反应近景/);
  assert.match(prompt, /明确无对白、固定机位或一镜到底的用户要求必须保留/);
  assert.match(prompt, /不继承为固定构图/);
  assert.doesNotMatch(prompt, /最后才写对白和动作正文/);
});

test('episode screenplay prompt requires full dialogue density instead of a scene outline', () => {
  const prompt = buildEpisodeScreenplayPrompt({
    idea: '一名调查人员追问一位干部的财产来源',
    episodeNo: '1',
    title: '账本之外',
    synopsis: '调查从住宅推进到别墅地下室，人物从否认转为承认。',
    episodeDurationSec: 90,
    detailLevel: 'detailed',
    expansionPolicy: 'balanced',
    format: 'short-film',
  });

  assert.ok(prompt.includes(SCREENPLAY_DIALOGUE_DENSITY_RULES));
  assert.match(prompt, /完整对白版剧本/);
  assert.match(prompt, /对白密度必须随场景功能和时长自适应/);
  assert.match(prompt, /不使用固定的总字数、固定轮次或固定的场景分配/);
  assert.match(prompt, /对白驱动场景只有一两句台词/);
  assert.doesNotMatch(prompt, /至少24轮发言/);
  assert.doesNotMatch(prompt, /典型四场90秒/);
  assert.match(prompt, /不要只输出分镜摘要或几句关键台词/);
  assert.match(prompt, /逐轮写出谁说了什么/);
});


test('Idea button plans concrete conflict and climax without downstream contracts', () => {
  const prompt = buildIdeaStoryPlanningPrompt('草船借箭', {
    format: 'short-series', episodeCount: 6, episodeDurationSec: 90,
    detailLevel: 'detailed', expansionPolicy: 'balanced',
    allowNewCharacters: false, allowSubplots: false, allowNewConflicts: false,
    tone: '轻喜剧', outputLanguage: 'zh-CN',
  });
  assert.match(prompt, /谁想得到什么、谁或什么阻止他/);
  assert.match(prompt, /高潮不等于任务完成、手续办妥或宣布成功/);
  assert.match(prompt, /哪个可见行动标志着变化/);
  assert.match(prompt, /只应用符合用户题材的表达/);
  assert.match(prompt, /不允许新增冲突时，只具体化已有冲突/);
  assert.match(prompt, /不新增审核门槛/);
  assert.match(prompt, /6 集/);
  assert.match(prompt, /90 秒/);
  assert.match(prompt, /不要调用 workshop_set_episode_script、workshop_set_shots/);
  assert.match(prompt, /workshop_set_breakdown 保存规划/);
  assert.match(prompt, /允许新增人物：否/);
  assert.ok(prompt.includes(STORY_DIRECTOR_REPORT_SAFETY));
  for (const rules of [STORY_DIRECTOR_CORE_RULES, STORY_DIRECTOR_CONTINUITY_RULES, STORY_DIRECTOR_DELIVERY_CONTRACT]) assert.ok(!prompt.includes(rules));
  assert.doesNotMatch(prompt, /single-timeline|4-7 秒|5-12 秒|accepted review|entryState/);
});

test('Idea button uses dedicated planning prompt while keeping persistence fields', () => {
  const source = readFileSync(new URL('../../components/workshop/steps/StepScript.tsx', import.meta.url), 'utf8');
  assert.match(source, /buildIdeaStoryPlanningPrompt\(content, effectiveSpec\)/);
  assert.doesNotMatch(source, /buildStoryDirectorPrompt\(/);
  assert.match(source, /synopsis、episodes、narrativeBeats、characters、scenes、props/);
  assert.match(source, /sourceEvidence/);
});


test('Idea planning adapts to other genres without forcing comedy or two-person conflict', () => {
  for (const [genre, tone] of [['生活成长', '温和治愈'], ['悬疑推理', '紧张'], ['科幻冒险', '探索未知'], ['家庭', '悲剧']]) {
    const prompt = buildIdeaStoryPlanningPrompt('保留原始人物和开放结局，无对白', {
      format: 'short-film', episodeCount: 1, episodeDurationSec: 90,
      detailLevel: 'detailed', expansionPolicy: 'conservative',
      allowNewCharacters: false, allowSubplots: false, allowNewConflicts: false,
      genre, tone, endingType: '开放结局',
    });
    assert.ok(prompt.includes(`题材：${genre}`));
    assert.ok(prompt.includes(`故事调性：${tone}`));
    assert.match(prompt, /不默认轻喜剧/);
    assert.match(prompt, /独角戏不必新增对手/);
    assert.match(prompt, /不要求必须有两方对抗/);
    assert.match(prompt, /不把所有类型要求叠加/);
    assert.match(prompt, /无对白、慢节奏、开放结局/);
    assert.match(prompt, /不新增审核门槛/);
    assert.doesNotMatch(prompt, /甲放下清单|调动人手|双方带着什么诉求进入/);
  }
});


test('prompt save does not warn on missing expression or camera keywords', () => {
  const source = readFileSync(new URL('../agent/tools/workshopTools.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /imagePrompt 缺少表演瞬间或微表情|videoPrompt 缺少演员表演微动作\/微表情|videoPrompt 缺少明确的单一主要机位、主要运镜或焦点设计/);
  assert.doesNotMatch(source, /Seedance 提示词检查/);
});

test('Idea generation plans distinct episode outcomes and causal continuity before filling fields', () => {
  for (const [format, genre, tone] of [
    ['short-series', '神话动作', '热血，结尾悲壮'],
    ['short-series', '悬疑', '紧张'],
    ['slow-drama', '家庭成长', '温和'],
    ['short-film', '科幻', '探索'],
    ['series', '爱情', '克制'],
  ] as const) {
    const prompt = buildIdeaStoryPlanningPrompt('沿用已给定的主线与结局', {
      format, genre, tone, episodeCount: 12, episodeDurationSec: 90,
      detailLevel: 'detailed', expansionPolicy: 'balanced',
      allowNewCharacters: false, allowSubplots: false, allowNewConflicts: false,
    });
    assert.match(prompt, /整季设计先于逐集填表/);
    assert.match(prompt, /不只是更换对手、地点后重演同一种受阻与脱困/);
    assert.match(prompt, /不机械轮换输赢/);
    assert.match(prompt, /用户追求热血或爽感时/);
    assert.match(prompt, /用户明确要求的改编优先/);
    assert.match(prompt, /不确定的原作细节不要冒充原作事实/);
    assert.match(prompt, /失去的物品再次使用前要有取回或替代的事件/);
    assert.match(prompt, /同一集内部也要一致/);
    assert.match(prompt, /场次名称写实际发生地/);
    assert.match(prompt, /不能各字段各编一版/);
    assert.match(prompt, /不新增审核门槛/);
    assert.doesNotMatch(prompt, /孙悟空|金箍棒|二郎神|诸葛亮|草船/);
    assert.doesNotMatch(prompt, /single-timeline|accepted review|entryState/);
  }
});

test('fast planning and screenplay allow a resolved finale instead of mandatory new danger', () => {
  const spec = {
    format: 'short-series' as const, episodeCount: 12, episodeDurationSec: 90,
    detailLevel: 'detailed' as const, expansionPolicy: 'balanced' as const,
    allowNewCharacters: false, allowSubplots: false, allowNewConflicts: false,
    endingType: '悲剧',
  };
  const planning = buildIdeaStoryPlanningPrompt('阶段性胜利后最终失败', spec);
  const screenplay = buildEpisodeScreenplayPrompt({
    ...spec, idea: '阶段性胜利后最终失败', episodeNo: '12', title: '终章',
  });
  for (const prompt of [planning, screenplay]) {
    assert.match(prompt, /不能为了追更撤销当集成果/);
    assert.match(prompt, /结局集按用户指定结局收束/);
    assert.doesNotMatch(prompt, /每集结尾要留下具体的新问题|每集都要有当集目标、阻力升级/);
  }
  assert.match(planning, /追更钩子可为空或写收束余韵/);
  assert.doesNotMatch(planning, /最后附一个可直接导入/);
});

test('Idea planning separates author instructions from persisted story events across formats', () => {
  for (const [format, genre, outputLanguage] of [
    ['short-series', '神话动作', 'zh-CN'],
    ['slow-drama', '家庭成长', 'zh-CN'],
    ['short-film', '悬疑', 'en-US'],
    ['series', '爱情', 'zh-CN'],
  ] as const) {
    const prompt = buildIdeaStoryPlanningPrompt('不要重复冲突，保留人物内心活动', {
      format, genre, outputLanguage, episodeCount: 6, episodeDurationSec: 90,
      detailLevel: 'detailed', expansionPolicy: 'balanced',
      allowNewCharacters: false, allowSubplots: false, allowNewConflicts: false,
    });
    assert.match(prompt, /创作指令与故事内容分离/);
    assert.match(prompt, /用户 Idea 中的节奏、风格、连续性与禁止事项/);
    assert.match(prompt, /synopsis、各集梗概、centralConflict、climax、openingState、endingState、cliffhanger 及 Scene\/Beat 的剧情描述/);
    assert.match(prompt, /不以“展示主角实力”“验证人物机敏”等创作作用替代人物动机/);
    assert.match(prompt, /也不要把它们转成角色台词/);
    assert.match(prompt, /Scene\/Beat 中专门的叙事功能字段仍可简述作用/);
    assert.match(prompt, /不机械删除否定句或把所有内心活动改成动作/);
    assert.match(prompt, /用户明确要求的元叙事也应保留/);
    assert.match(prompt, /不附生成后的自评、合规声明或额外审核报告/);
    assert.match(prompt, /不新增审核门槛/);
    assert.match(prompt, /不要调用 workshop_set_episode_script、workshop_set_shots/);
  }
});

test('Idea planning explains changes through events instead of state or effect placeholders', () => {
  const prompt = buildIdeaStoryPlanningPrompt('按已有事实规划', {
    format: 'short-series', episodeCount: 6, episodeDurationSec: 90,
    detailLevel: 'detailed', expansionPolicy: 'conservative',
    allowNewCharacters: false, allowSubplots: false, allowNewConflicts: false,
  });
  assert.match(prompt, /“主动使用状态恢复”“重新明确”“完成衔接”不算事件/);
  assert.match(prompt, /不为解释连续性另造事故/);
  assert.match(prompt, /选出真正改变结果的关键行动或发现/);
  assert.match(prompt, /从要求到事件的转换/);
  assert.match(prompt, /按当前故事已有事实和扩写权限选择具体事件/);
  assert.doesNotMatch(prompt, /孙悟空|金箍棒|二郎神|诸葛亮|草船/);
});
