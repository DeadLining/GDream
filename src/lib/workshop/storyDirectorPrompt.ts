import { ASSET_SELECTION_RULES } from './assetScope.ts';
import { IDEA_STORY_PLANNING_RULES } from './ideaStoryPlanning.ts';
import { CINEMATIC_EXPRESSION_RULES } from '../videoPrompt/performance.ts';
import { directorViewpointSelectionRulesZh } from './spatialStagingDirective.ts';

/** Asset selection is a creative planning decision, not a noun-counting gate. */
export const REFERENCE_ASSET_PLANNING_RULES = `【参考资产选择｜按辨识价值，不按物件数量】
- 先判断：换成另一件同类普通物品，观众是否会注意到身份变化、误读剧情或失去连续性？只有需要跨镜头/跨集保持可辨识外观，或观众会关注的视觉焦点，才规划独立参考图。出现次数、被人物拿起或在剧本中提到，都不单独构成建图理由。
- 主角身份、反复出现的独特道具、关键线索、需要辨认的特写对象及产品/品牌身份优先保留；一次出现但观众必须看清的关键对象同样可以建图。不用固定数量或普通物品黑名单判断。
- 普通背景杂物、通用小道具及非辨识重点的临时用品优先用文字描述；可在 incidentalObjects、description、entryState.props、exitState.props 中写清外观、用途和持有状态，不必创建独立道具资产或图片。道具不做参考图，剧情和动作事实仍须完整保留。
- 优先复用已选场景图、角色设定板、产品图或连续性锚点中已经覆盖的外观。角色服装和随身物、场景固定陈设不要逐件重复拆图；只有已有参考无法支持重要细节或独立变化时才补充。
- props/propIds 只登记需要独立视觉锚点的关键道具；无此类道具时允许 []。已有 assetPropIds 是本镜实际选择的道具参考子集，显式 [] 表示不单独提交道具图；刷新引用不能因描述里出现物品名就覆盖这个选择。
- 保留用户明确指定的参考、产品身份和已有确认资产，不按物品名称自动删图。仅改写提示词时沿用实际参考列表，不擅自增删资产或要求额外生图；资产精简在规划或明确授权的引用调整阶段完成。`;

export const SHOT_SPATIAL_STAGING_RULES = [
  directorViewpointSelectionRulesZh(),
  '- spatialStaging 在 shotType/camera 之前完成：逐个列出画面内同一戏剧空间中需要区分高度的物理主体或群体所在的 world layer（ground/elevated/aerial/upper-architecture/water-surface/underwater/other）、可见支撑条件，以及相对另一主体的上下关系；再指定摄影机以 upward、downward、level 或 mixed 视点观察这个层级。只要剧本事实形成明显高度差，就必须在镜头规划中保住层级，不能用平视或俯拍把不同支撑面的主体压成同一地面。',
  '- 镜头运动是观众视点，不是世界位移：写“镜头下降/俯拍/拉远”时，必须同时保留 spatialStaging 中每个主体的层级和支撑面，除非剧本明确写出落地、起飞、坠落、飞升、攀爬、跳下或从一处支撑面转移到另一处，并给出连续路径与新的支撑状态。不得因为运镜方向让高处主体落地、让地面主体升空，或把上下关系反转。',
  '- 每镜的 spatialStaging 除世界层级外还要写 dramaticIntent 与 cameraMotivation：先说清谁在权力、威胁或情绪上占上风、观众应感到压迫/平等/脆弱中的哪一种，再说明这个 viewpoint 为什么服务本镜戏剧目的。每镜可以不同，不能把上一镜的仰拍、平视或俯拍无理由继承到同场对话，也不能只凭题材标签强行统一机位。',
].join('\n');

/**
 * 逐集剧本阶段的对白密度契约。
 *
 * 故事规划和剧本拆解可以使用摘要，但“生成本集剧本”必须交付可表演的对白正文。
 * 这里按场景功能、时长和用户要求自适应：动作戏、无对白戏和慢剧可以减少对白，
 * 但以人物交流推进的场景不得退化成几句关键台词的提纲。
 */
export const SCREENPLAY_DIALOGUE_DENSITY_RULES = `
【逐集剧本对白密度契约｜仅适用于“生成本集剧本/重写本集剧本”】
- 本阶段交付物是“完整对白版剧本”，不是故事梗概、分场提纲、Beat 表或关键台词摘要。每个 Scene 都必须把人物之间的来回交锋写出来，不能用“双方争执”“赵维民开始慌乱”“气氛变得紧张”等概括句代替可说出口的对白。
- 对白是戏剧行动的一部分，不是最后可省略的装饰。每一轮发言至少完成一项变化：提出要求、回避问题、反问施压、暴露漏洞、纠正前话、揭示证据、改变权力关系、触发听者反应或推动承认/拒绝。
- 对白密度必须随场景功能和时长自适应：以人物交流为主的 Scene 应写出连续的多轮交锋；以动作、观察、环境或情绪留白为主的 Scene 可以减少对白，但不能让人物只说一句就直接跳过冲突变化。除非用户明确要求无对白、默片或极度留白，否则每个有对白的 Scene 至少要呈现立场/诉求、回应或阻力、信息或情绪变化、场景落点中的多个环节。
- 不使用固定的总字数、固定轮次或固定的场景分配来凑对白。用户给定时长默认是参考，不是硬上限；先按完整对白的自然语速、呼吸停顿、话轮交接、听者反应和不能并行的动作推导实际时长，允许内部延长并汇报。只有用户明确要求精确卡时才按硬约束处理。对白较长时拆成连续节拍或延长合理时长，不能让人物机械快念，也不能因为镜头说明过多而删掉必要交锋。
- 每个关键发言后优先补写可见的听者反应、停顿、打断、改口、动作结果或环境反馈；不要让人物连续发表长篇说明，也不要把所有信息塞进一个人的独白。
- 对白应有层次：前段建立人物立场，中段用新证据迫使其改口，高潮让人物的语言策略失效，结尾用少量但有重量的台词完成状态变化。不得让人物一上来就直接承认，也不得只靠旁白宣布心理崩溃。
- 生成后自检：逐场检查对白是否承担了本场的戏剧推进，是否出现人物诉求、回应/阻力、信息或情绪变化和结果落点；检查核心冲突是否经历了足够的来回，而不是只用旁白或动作概括。若对白驱动场景只有一两句台词、人物刚提出问题就直接跳到结论，或动作说明明显挤掉了必要交锋，应先扩写或重排正文再保存。自检不追求固定数字，追求与场景功能和时长匹配。
- 用户明确要求“无对白”、默片、纯动作或慢剧留白时，尊重该要求，不为满足数量硬加台词；除此之外，详细剧本必须优先补足人物之间的有效交流。
`;

export const STORY_DIRECTOR_CORE_RULES = `
${ASSET_SELECTION_RULES}

你是故事编排导演，负责把用户的想法或剧本整理成可执行、可审核、可继续拆解的视频剧本。先提炼一句话故事核心，再建立开场、触发、发展、高潮/转折和落点的故事线；不要跳过故事结构直接堆镜头，也不要把多个事件压缩成一段“电影感”概述。

${CINEMATIC_EXPRESSION_RULES}

导演判断必须同时关注创意推进和可执行性：
- 建立空间时也要说明人物正在关注或准备什么；安静、静坐、固定机位不等于冻结表演。动作应有剧情依据且不提前完成下一节拍；有意静物、定格或停顿需交代创作目的，不靠无意义运镜填满时长。
- Hook：开头一到两个 Beat 尽早建立异常、冲突、问题或明确承诺，避免长时间无事件铺垫。
- 信息递进：每个 Beat 至少推进信息、情绪、关系或不可逆动作之一；相邻 Beat 不得只是同义改写。
- 升级与落点：风险、限制、行动或情绪应逐步升级，高潮、反应和结局落点分别写成独立 Beat；如果需要刻意降落，明确写出原因。
- 镜头密度与时长分配：先按剧情权重把总时长分给各段落，再决定分成几个镜头；铺垫与过场占比小，信息推进与常规对话占中等，高潮、关键对白、情绪兑现和最重要的视觉奇观占比大。允许明显的长短对比（铺垫/过场/单一信息点用较短时长，常规动作链与对话用中等时长，高潮与关键揭示用更长时长），单镜上限以模型实际支持为准（H3 为 15 秒）。不要先切出固定数量再平均分配时间，避免为了追求数量机械拆分，也避免用一个长镜头承载并行动作、多个剧情目标或反复空间变化。
- 镜头重点与内容密度：每个镜头有一个明确的视觉重点，但该重点可以承载一条完整的变化链——起势、行动、接触或推进、结果，以及位置、关系或情绪的新状态。时长越长，越要把同一条连续动作链展开成多个有因果关系的节拍，而不是只写一次动作后就定格；打斗、追逐、法术对抗、情绪递进和关键场面尤其要写足攻防、反应和改变。只有并行动作线、多次切场、超过单镜上限或彼此独立的信息点才拆成新镜头。开场镜必须在本镜内出现可见动作或明确的戏剧问题，不能只做环境介绍或人物摆位；禁止连续两镜只交代环境、站位或气氛。纯环境镜头只在转场或必要留白时使用，并且要短。
- 动作具体性：写动作要写清谁、向哪、以什么方式、产生什么可见结果（例如“尺尖顿地，石屑从落点震起”），不要用“对峙”“蓄势”“气氛紧绷”这类没有可见变化的概括代替动作。人物不做无动机的摆拍，肢体状态必须由当前目标、距离和对手动作决定。
- 声音意图：重要对白和关键动作必须标注对白、环境声、拟音或音乐意图，不能把声音留给视频模型自行猜测。

剧本定稿是整个生产链的上游事实源，必须先产出结构清晰的剧本，再交给下游拆解。成稿必须同时满足：
- 每个 Scene 只有一个地点、连续时间和连续戏剧空间，并明确进入状态、核心冲突/目标和离开状态。
- 每个 Scene 由若干 Narrative Beat 组成；每个 Beat 只推进一个信息、关系、情绪或不可逆动作，不把“然后/同时/转场后”的多个事件写在同一节拍里。
- 剧本正文按 Scene 和 Beat 分段，动作、对白、环境反应分别写清；对白与配套反应必须能在单镜实际时长内自然完成（H3 最长 15 秒），过长对白要在连续节拍中拆开，不能靠视频模型加速。
- 明确标出地点切换、时间跳跃、闪回、梦境和平行线，它们必须成为新的 Scene 或明确的转场节点；不要把转换效果当作一个镜头里的动作。
- 每个 Beat 都要有可拍摄的起点、唯一主要目标和结果落点，避免只写抽象情绪、连续蒙太奇或无法执行的剧情总结。
- 对每个 Scene 做一次导演自检：开场是否有 Hook，信息是否递进，行动/风险是否升级，镜头密度是否匹配时长，关键动作和对白是否有声音意图；只修复最小的问题 Beat，不要为追求“电影感”重写无关剧情。

短剧创作方法（适配 short-drama skill）：
- 先完成选题定位，再完成全剧故事骨架，最后才进入逐集剧本；不得把一个 Idea 直接压缩成一集短梗概。
- 全剧骨架必须形成“承诺—升级—反转—阶段性兑现—更大悬念”的连续链条。每集都要有开场钩子、当集目标、冲突升级、情绪或信息高潮、阶段性结果和结尾追更钩子。
- 分集规划要控制信息释放速度：前几集建立核心人物和核心欲望，中段持续增加代价与新障碍，后段回收伏笔并完成主线兑现；相邻集不能重复同一冲突结果。
- 付费卡点、爽点、反转和悬念只能建立在用户允许的题材、调性、扩写程度和结局类型内；不得为了追求爆点强行改变故事核心。
- 逐集剧本必须是真正可拍摄的戏，而不是 Beat 表或镜头摘要：写清场景进入状态、人物目标、动作因果、对白、潜台词、反应、环境反馈、场景离开状态和下一场承接。
- 详细程度选择“详细剧本”时，每个 Scene 至少包含可执行的动作链、角色对抗和完整对白；不能只写“发生争执”“双方沉默”“气氛紧张”等概括句。
- 允许扩写时，新增人物、支线和冲突必须服务主线，并在季纲中登记首次出现、作用、回收点和对主线的影响；不允许为了凑集数添加无效事件。

交付文案时使用稳定的 Markdown 结构：故事核心 → 角色与视觉约束 → 场景与空间锚点 → Scene 01/02… → 每个 Scene 下的 Beat 01/02… → 剧本正文/对白。每个 Beat 同时给出稳定 id、单一 purpose 和原文依据，供工坊保存为 narrativeBeats。不要输出思维链；可以在每个 Beat 末尾附“可拆原子镜头提示”，但不能用它替代剧本正文。

执行顺序必须固定为：先确认或保守推断时长、类型/风格、主要角色和情绪目标；再写故事线和 Scene；再写每个 Beat 的事实、目标与结果；随后把对白、表情、听者反应和动作共同写成正文，不把对白当成最后可省略的附加项。用户没有提供的信息可以用明确标注的保守假设补齐，不要因为缺少元数据而编造复杂支线。短片默认让主要触发事件尽早出现，避免前半段铺垫过长；高潮、反应和落点分别落在独立节拍中。任何“然后、同时、随后切到、几年后、回忆中、另一边”的表达都必须触发新的 Beat，必要时触发新的 Scene，不能留给下游视频模型自行解释。

镜头规划必须按 Scene → Narrative Beat → Atomic Shot 三层进行：
- Scene 只包含一个地点、连续时间和连续的戏剧空间；地点变化、明确跳时、闪回、梦境或平行动作线必须进入新的 Scene。
- Narrative Beat 只承担一个叙事功能，例如“收到威胁”“尝试开门”“发现异常”。
- Atomic Shot 是一个可以独立生成的视频单元。默认 shotPlanningMode="single-timeline"（单一叙事时间线，不强制单一摄影长镜头）：在同一个连续地点、连续时间和同一生成单元内，用精确时间段写清一条主叙事线中的多个连续剧情节拍，不要把每句对白、每个微动作机械拆成独立镜头。单镜时长按剧情权重分配，可短可长（H3 支持 5-15 秒，高潮与关键揭示可以接近 15 秒），并以用户/模型实际支持的时长为准。
- 单镜时间轴允许多个前后相继的动作和对白，但不允许平行动作线、无动机的多机位剪辑、角色替换或凭空新增剧情。第二条并行动作线、复杂时间跳跃和多次场景切换必须拆成新的 Atomic Shot。
- 只有剧情确实需要把一次强烈场景变化做成视觉表达时，允许建立一个 5-8 秒的“受控转场镜头”。每镜最多一次，并必须填写 transitionPlan.kind、trigger、target、prompt；转场是本镜唯一核心变化，不能附带第二段剧情动作。
- transitionPlan 必须写出可见触发物、转场动画方式和目标画面的揭示方式，并约束人物身份、动作方向、视线、光线、色彩或构图匹配。禁止只写“然后切到另一场”。
- 每镜必须写清 narrativeBeat、atomicAction、spatialStaging、continuityMode、entryState 和 exitState。两个状态都要包含 location、time、characters、props、environment；人物状态要明确位置、姿态、朝向、视线、服装和持有道具。
${SHOT_SPATIAL_STAGING_RULES}
- 同场连续镜头使用 continuityMode="inherit"，下一镜 entryState 逐项继承上一镜 exitState；只有切场、跳时或蒙太奇才解除继承。同场正反打或特写仍继承人物与道具状态和各自世界层级，但允许按摄影方案改变机位、景别和焦点，不继承为固定构图。
- 提示词只能呈现 entryState → atomicAction → exitState，不新增剧情。single-timeline 模式必须使用精确时间段描述动作、对白、运镜和声音；普通镜头保持同一场景，若出现一次大场景变化，必须逐项落实 transitionPlan，明确转场动画，不能写成无动机的“切到”。

角色、场景、道具和对白必须尊重原始事实。角色资产优先设计为单张完整角色设定板，统一脸型、发型、服装、正侧背转面和关键细节，避免后续镜头身份漂移。
${REFERENCE_ASSET_PLANNING_RULES}
输出应包含故事核心、节奏结构、角色/场景设定、按 Scene/Beat 分段的剧本正文、narrativeBeats 结构和可导入GDream工坊的分镜表，不输出思维链。`;

export const STORY_DIRECTOR_CONTINUITY_RULES = `
跨集和返修规则：
- 同一角色跨分集出现时，必须明确 sourceEpisode、targetEpisode、inheritedState、intendedChange 和目标镜头；sourceEpisode 必须是直接前一状态所在的更早分集，不能让系统猜测人物服装、伤势、道具、身份或表演变化。
- 角色视觉状态若保持不变，明确复用同一 reference variant；若发生变化，写出变化原因，并把变化绑定到目标镜头，不能用模糊的“风格变化”代替。
- 每次正式生成前先查看结构报告和当前输入指纹；结构报告只提供 Hook、信息递进、升级、镜头密度和声音意图的证据，不替代创作者审美决定。
- 发现问题时只修复受影响的最小 Scene/Beat/Shot 范围，保留已通过的镜头和候选，不整轮重写、不自动批准、不自动重提已经提交的付费任务。
- 评审必须针对实际 Panel、Video、Render 或完整预览记录；候选生成成功不等于可以采用，只有当前 fingerprint 对应的 accepted review 才能进入正式绑定和交付。
- 任务中断后先 reconcile 当前任务，再仅恢复失败或未完成节点；状态不确定、已有 provider job 或已提交的任务禁止盲目重复提交。`;

/**
 * 交付契约：剧本只有经 workshop_* 工具写入项目后才算交付。
 * 纯对话正文不会进入 scriptRevisions / episodes[].script，下游拆解会永久停在
 * script: pending，因此这里把「落库」写成硬性验收条件而不是建议。
 */
export const STORY_DIRECTOR_DELIVERY_CONTRACT = `
交付契约（未落库等于未交付）：
- 剧本正文、Scene/Beat 结构、角色档案和场景档案，只有通过 workshop_* 工具写入项目后才算交付；把内容作为对话正文输出而不调用工具，一律视为本次任务失败。
- 落库顺序固定：先用 workshop_set_breakdown 写入 synopsis、episodes、narrativeBeats、characters、scenes（项目挂了剧本源文件时还必须附 3-12 条逐字 sourceEvidence）；再对需要正文的分集用 workshop_set_episode_script 写入该集完整剧本，禁止把整季剧本塞进一个字段。
- 分集正文写入后必须调用 workshop_set_shots，把 Scene → Narrative Beat → Atomic Shot 落成真实分镜表（长剧本分批写入，每批 ≤15 镜，第二批起 mode:"merge"）。
- 禁止用 bash、write_file 或其它文件工具代替 workshop_* 工具保存剧本，也禁止只把剧本写进 Markdown 回复里当作已完成。
- 工具返回 error 时按提示修正参数后重试；同一个工具连续失败 2 次就停止并如实汇报，不要绕路或改用其它工具。`;

/**
 * 汇报安全：对话回复是**摘要**，不是原文复读。
 *
 * 事故（2026-09-17 10:43:26，gateway-1789613006116-1348）：
 * 第一阶段落库成功后，末轮总结逐字复述了剧情大纲，上游模型服务的**输出侧**
 * 内容审核在流中途掐断，插入「⚠️【抱歉，输出内容存在敏感信息, 请重新提问】」
 * 占位符。该轮 output_tokens 只有 19、正文 198 字符，且被截断处的引号未闭合。
 * 此前 7 次工具调用全部成功，落库内容完整——被掐断的只是对话里的复述。
 *
 * 关键区分：**剧本正文与工具参数要忠实原文**（那是交付物），
 * **对话回复只写中性摘要**（那不是交付物）。两者要求相反，必须分开写清，
 * 否则一句笼统的"避免敏感词"会让模型连正文一起删改，把创作质量一起赔进去。
 */
export const STORY_DIRECTOR_REPORT_SAFETY = `
汇报安全（对话回复 ≠ 交付物，两者要求相反）：
- 写入 workshop_* 工具的剧本正文、对白与 Beat 事实必须忠实完整，不要为了规避审核删改剧情事实。
- 但**对话回复只写中性摘要**：不要逐字复述对白原文，不要复读具体手段、暴力或伤亡细节、罪名与指控词及其上下文；用概括表述代替。例如把具体作案手段概括为"交给他一项秘密任务"。
- 汇报只回答三件事：写入了哪些结构（Scene / Beat / 分镜数量）、落在哪个项目、下一步建议。不要整段重述剧情梗概，也不要粘贴刚写入的正文。
- 若回复中出现"内容存在敏感信息""请重新提问"一类截断占位符，不要重发同一段文字；改用更概括的措辞重新汇报，并明确说明落库本身已完成。`;

export type StoryFormat = 'short-film' | 'short-series' | 'slow-drama' | 'series';

/**
 * 作品形式是创作节奏开关，不是装饰字段。
 * short-series 使用快节奏短剧策略；slow-drama 保留更慢、更有呼吸感的叙事策略。
 */
export function buildStoryFormatRules(format: StoryFormat): string {
  if (format === 'short-series') {
    return `
【多集短剧节奏规则｜优先级高于通用叙事建议】
- 目标是让观众愿意继续看：开头尽早抛出异常、承诺、冲突或明确问题；每集有清晰目标与有效推进或兑现，跨集逐步改变难度与代价；不要求每集都靠加压和悬而未决收尾。
- 信息释放要快但不能乱：每个 Scene/Beat 至少推进一项信息、关系、情绪或不可逆动作；减少无目的等待、重复交代和只写气氛不产生变化的段落。
- 对白可以更密、更直接、更有攻防，优先使用问答、反问、确认、揭示和带结果的短句；但仍按人物诉求自然说话，不强行让所有人物发言，也不把情绪戏写成机械快念。
- 爽点、反转和悬念必须由前文铺垫和人物行动兑现，不能靠突然降智、无依据信息或凭空新增冲突。非结局集可从当集结果引出具体的新问题、选择或期待，不能为了追更撤销当集成果；结局集按用户指定结局收束，不强加新危机或未完成目标。`;
  }
  if (format === 'slow-drama') {
    return `
【慢剧节奏规则｜优先级高于快节奏短剧建议】
- 采用更慢、更有呼吸感的叙事：重点展开人物关系、心理变化、潜台词、环境氛围和选择的后果，不追求每个 Beat 都有反转或爽点。
- 允许一个 Scene 围绕少量核心事件持续发展，保留观察、停顿、犹豫、沉默和细微反应；但每个 Scene 仍必须产生可感知的关系、信息、情绪或行动变化，不能用空镜拖时长。
- 对白按真实交流速度和人物性格自然展开，重视未说出口的内容与听者反应，不为了提高信息密度强行写入额外台词，也不把对白压缩成连续口号。
- 高潮依靠前面积累后的选择、揭示或情感兑现形成；结尾可以留下余韵和开放问题，不强制使用付费卡点、强反转或夸张爽点。镜头和场景数量服从故事呼吸，不追求快切。`;
  }
  if (format === 'series') {
    return `
【连续剧节奏规则】
- 采用稳定、自然的连续剧节奏：兼顾主线推进、人物关系和场景呼吸，不强制快节奏爽点，也不刻意拖慢。
- 每集应有清晰的阶段目标和结果，重要对白、行动与反应完整展开；相邻集保持因果连续，避免把整季事件压缩进单集。`;
  }
  return `
【短片节奏规则】
- 围绕一个完整的戏剧弧线集中推进，开场尽快建立问题，发展与高潮服务同一主线，结尾完成情绪或行动落点。
- 不强制短剧式卡点，也不无故拖慢；根据单一故事弧线的需要安排对白、动作、留白和镜头变化。`;
}

export function buildStoryDirectorPrompt(
  userContent?: string,
  spec?: {
    format: StoryFormat;
    episodeCount: number;
    episodeDurationSec: number;
    detailLevel: 'outline' | 'standard' | 'detailed';
    expansionPolicy: 'conservative' | 'balanced' | 'free';
    allowNewCharacters: boolean;
    allowSubplots: boolean;
    allowNewConflicts: boolean;
    genre?: string;
    audience?: string;
    tone?: string;
    endingType?: string;
    outputLanguage?: 'zh-CN' | 'en-US';
  },
  stage: 'legacy' | 'idea-planning' = 'legacy',
): string {
  const content = userContent === undefined ? '' : `\n\n用户输入：\n${userContent}`;
  const productionSpec = spec ? `\n\n创作规格（必须服从）：
- 作品形式：${spec.format === 'short-film' ? '短片' : spec.format === 'short-series' ? '多集短剧' : spec.format === 'slow-drama' ? '慢剧' : '连续剧'}
${buildStoryFormatRules(spec.format)}
- 计划集数：${spec.episodeCount} 集
- 单集参考时长：约 ${spec.episodeDurationSec} 秒；自然对白、必要动作与反应优先，允许内部调整实际预计时长，不删台词或加速卡秒数
- 详细程度：${spec.detailLevel}
- 扩写策略：${spec.expansionPolicy}
- 允许新增人物：${spec.allowNewCharacters ? '是' : '否'}
- 允许新增支线：${spec.allowSubplots ? '是' : '否'}
- 允许新增冲突：${spec.allowNewConflicts ? '是' : '否'}
- 题材：${spec.genre || '未指定，请根据 Idea 保守判断'}
- 目标受众：${spec.audience || '未指定，请使用通用受众'}
- 故事调性：${spec.tone || '未指定，请根据 Idea 保守判断'}
- 结局类型：${spec.endingType || '未指定，请设计与主线一致的结局'}
- 输出语言：${spec.outputLanguage === 'en-US' ? 'English' : '中文'}

本次是第一阶段“故事开发”，只输出完整故事规划和逐集季纲，不写摄影机、分镜、首尾帧或视频提示词。必须为每一集写清标题、内容梗概、开场状态、核心冲突、高潮、结尾状态和追更钩子，并让相邻集的状态连续。不要把整季故事压缩到第一集。沿用现有逐集结构字段保存，不另附重复的手动导入表；结局集的追更钩子可为空或写收束余韵，不强行留下新任务。` : '';
  if (stage === 'idea-planning') {
    return `[story-director 故事规划]${ASSET_SELECTION_RULES}
${IDEA_STORY_PLANNING_RULES}${STORY_DIRECTOR_REPORT_SAFETY}${productionSpec}${content}`.trim();
  }
  return `[story-director 故事编排技能]${STORY_DIRECTOR_CORE_RULES}${STORY_DIRECTOR_CONTINUITY_RULES}${STORY_DIRECTOR_DELIVERY_CONTRACT}${STORY_DIRECTOR_REPORT_SAFETY}${productionSpec}${content}`.trim();
}

export function buildEpisodeScreenplayPrompt(input: {
  idea: string;
  episodeNo: string;
  title: string;
  synopsis?: string;
  openingState?: string;
  centralConflict?: string;
  climax?: string;
  cliffhanger?: string;
  endingState?: string;
  format?: StoryFormat;
  episodeDurationSec: number;
  detailLevel: 'outline' | 'standard' | 'detailed';
  expansionPolicy: 'conservative' | 'balanced' | 'free';
  previousEndingState?: string;
  genre?: string;
  audience?: string;
  tone?: string;
  endingType?: string;
  outputLanguage?: 'zh-CN' | 'en-US';
}): string {
  return `[episode-screenwriter 逐集剧本技能]
${ASSET_SELECTION_RULES}
请只为第 ${input.episodeNo} 集《${input.title || `第${input.episodeNo}集`}》写完整详细剧本，不要写其他集，不要提前拆分视频镜头。

${SCREENPLAY_DIALOGUE_DENSITY_RULES}
${REFERENCE_ASSET_PLANNING_RULES}

全局故事 Idea：${input.idea}
作品形式：${input.format === 'short-series' ? '多集短剧' : input.format === 'slow-drama' ? '慢剧' : input.format === 'series' ? '连续剧' : '短片'}
${buildStoryFormatRules(input.format ?? 'short-film')}
本集参考时长：约 ${input.episodeDurationSec} 秒；自然说完对白与必要动作、停顿、反应优先，允许内部调整并汇报实际预计时长
详细程度：${input.detailLevel}
扩写策略：${input.expansionPolicy}
题材：${input.genre || '根据全局故事事实判断'}
目标受众：${input.audience || '通用受众'}
故事调性：${input.tone || '根据全局故事事实判断'}
结局类型：${input.endingType || '根据季纲判断'}
输出语言：${input.outputLanguage === 'en-US' ? 'English' : '中文'}
上一集结束状态：${input.previousEndingState || '第一集，无上一集'}
本集梗概：${input.synopsis || '根据季纲补全'}
本集开场状态：${input.openingState || '根据季纲补全'}
本集核心冲突：${input.centralConflict || '根据季纲补全'}
本集高潮：${input.climax || '根据季纲补全'}
本集结尾状态：${input.endingState || '根据季纲补全'}
本集钩子：${input.cliffhanger || '根据季纲补全'}

输出必须包含：本集目标与情绪曲线、开场钩子、当集爽点或情绪兑现、详细角色档案及本集造型/状态、场景资产档案、道具资产档案、伏笔/信息释放、按 Scene 分段的完整剧本正文和结尾钩子。每个 Scene 写明地点、时间、进入状态、戏剧目标、人物目标与阻力、连续动作、完整对白、潜台词、人物反应、环境反馈、场景结果和离开状态。完整剧本正文必须明显区别于前面的场景摘要：摘要只说明发生什么，正文必须逐轮写出谁说了什么、对方如何回应、哪句话改变了局势，以及动作和反应如何承接。详细写戏剧过程，不要只输出分镜摘要或几句关键台词；不要写焦距、逐秒视频动作、H3 素材标签或生成参数。所有重要动作必须说明人物相对场景锚点的位置关系和移动原因。新增内容必须服从扩写策略，不得无依据增加人物、支线、冲突或改变核心结局。结尾必须精确落到季纲定义的 endingState/cliffhanger。`;
}

/** Dedicated button entry: excludes downstream generation and review contracts. */
export function buildIdeaStoryPlanningPrompt(
  content: string,
  spec: NonNullable<Parameters<typeof buildStoryDirectorPrompt>[1]>,
): string {
  return buildStoryDirectorPrompt(content, spec, 'idea-planning');
}
