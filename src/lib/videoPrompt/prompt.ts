import { quickChat } from '@/lib/agent/quickChat';
import { auditUniversalVideoPrompt } from './audit';
import { AI_DRAMA_BAN, PERFORMANCE_GUIDE } from './performance.ts';

export { auditUniversalVideoPrompt } from './audit';
export type { VideoPromptAuditResult } from './audit';

export type VideoPromptTemplate = 'legacy' | 'universal';

export const VIDEO_PROMPT_TEMPLATE_STORAGE_KEY = 'gdream.videoPromptTemplate';

export function readGlobalVideoPromptTemplate(): VideoPromptTemplate {
  if (typeof window === 'undefined') return 'legacy';
  return window.localStorage.getItem(VIDEO_PROMPT_TEMPLATE_STORAGE_KEY) === 'universal'
    ? 'universal'
    : 'legacy';
}

export function writeGlobalVideoPromptTemplate(template: VideoPromptTemplate): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VIDEO_PROMPT_TEMPLATE_STORAGE_KEY, template);
}

export interface VideoPromptReference {
  label: string;
  kind?: string;
}

export interface RewriteUniversalVideoPromptInput {
  prompt: string;
  references: VideoPromptReference[];
  duration: number;
  ratio: string;
}

export interface RewriteVideoPromptOptions {
  signal?: AbortSignal;
  onProgress?: (status: string) => void;
  workspaceScope?: 'canvas' | 'workshop' | 'editor';
}

const SYSTEM_PROMPT = `你是专业影视导演与视频生成提示词编辑器。只输出可直接提交视频模型的最终提示词，不解释，不使用 Markdown 代码块。

目标：把用户要求整理成清楚、可执行、无内部矛盾的通用视频提示词。保留电影级摄影、材质、光影、表演和物理细节，但不得为了丰富而新增原文没有的人物、人物关系、事件、对白、旁白或关键道具。

输出结构依次为：
【素材身份】
【空间与初始站位】
【一句话概述】
【时间戳动作与机位】
【物理与一致性】
【视觉与声音】

严格遵守：
1. 素材身份必须按实际提交顺序写清 @图片N、@视频N、@音频N 的用途。不得输出文件名、内部 ID、路径，不得虚构素材。
2. 同一人物、动物、物品只能有一个身份、阵营、初始位置和身体结构。重复信息必须合并为唯一事实；发生冲突时优先保留原文最先明确锁定的设定，无法确认的内容宁可删减，不自行补写。
3. 空间层必须写清主体相对位置、朝向、距离或前后景关系。普通走位和超自然位移都要让起点与落点相对场景参照物清楚，不能只给出模糊的画面方位。
3.1 站位优先使用场景中的稳定锚点和人物相对关系描述，不只写“画面左/右”。普通走位按“相对锚点起点→可见步态与经过区域→距离逐步缩短或拉开→进入接触范围→最终相对位置”更新关系；可使用台阶、门框、桌边、固定家具、车辆、落地道具或另一人物作为参照。若原文明确是瞬移、闪现、缩地、遁光或空间跃迁，则按“发动前相对位置与触发动作→起点特效→消失/空间过渡→相对目标的落点、朝向和距离→现身及环境反馈→后续动作”描述，不把超自然位移改写成普通步行。机位连续移动和焦点变化应保持已建立的参照物关系清楚。
4. 时间轴覆盖完整时长，不重叠、不留空。允许同一条主叙事线中出现多个前后相继的动作、对白和反应，必须严格按 0.0-8.0 秒等时间段排列；不得出现并行动作线、角色替换或多次场景切换。若发生一次必要的大场景变化，必须明确写出连续转场动画、触发物和目标画面。
5. 动作按“起势→接触→受力→位移→恢复”描述。被占用、受伤或固定的肢体在释放前不能执行另一动作；武器、道具和攻击目标不得中途交换。
6. 整条提示词保持一条清楚的主视觉线和同一空间轴线，但要设计完整的运镜与景别层次：写清起幅与收幅景别、机位高度、推/拉/摇/移/升降/变焦/移焦的幅度与速度，可在同一镜头内组合多种有动机的运动。根据戏剧重点主动为表情、手部、动作接触或关键道具设计一次或多次有动机的特写，用连续推近、拉远、移焦、景别渐变或干净切入完成；特写必须服务既定动作或情绪落点，不得扩展成正反打、无动机碎切或快速蒙太奇。仅在原始要求确实需要时允许一次有动机的转场动画。
7. 导演约束卡只锁定站位、视线、机位和动作关系，不复制灰模材质。分镜板只作为构图、人物关系和画面层次参考，不得据此生成内部剪辑。
8. 人物、文物、商品等主体必须保持身份、外观、结构和关键细节一致；真人参考不得擅自改变五官、口型、动作或声音。
9. 保留原文明确要求的对白、旁白和声音；没有则不得新增。默认无字幕、贴纸、水印、随机文字和无关背景音乐。
10. 不输出“潜台词”、创作解释、教程、候选方案或自检过程。简单镜头可以缩短各节，但不得省略素材关联、时间轴和一致性要求。

${PERFORMANCE_GUIDE}

${AI_DRAMA_BAN}

提交前在内部完成一致性检查：素材编号、左右/前后方位、阵营、攻击目标、身体部位数量、肢体占用、动作因果、单一机位和时间段总长必须互相一致。只输出检查后的最终版本。`;

const CLASSIC_SYSTEM_PROMPT = `你是专业影视导演与原子镜头视频提示词编辑器。只输出可直接提交视频模型的最终提示词，不解释，不使用 Markdown 代码块。

请沿用GDream经典版标题结构；single-timeline 输入仍只输出一个生成镜头，但可在镜头1-1内部使用详细时间轴：
分镜场景设定在：交代地点、时间、空间、光线、人物和道具的初始关系。
分镜具体动作描述：概括本镜完整动作、表演和结果。
镜头1-1：从明确的入口状态开始，按 0.0-8.0 秒写清前后相继的动作、对白、连续运镜、焦点、物理反馈、台词与声音，在明确出口状态收束。不得输出镜头1-2、镜头1-3，不得出现并行动作线或角色替换。

严格遵守：
1. @图片N、@视频N、@音频N 必须按实际提交顺序引用，不得虚构素材或暴露文件名、路径、内部 ID。
2. 保留电影级机位、运镜、焦点、光影、材质和表演，但不得新增原文没有的人物、人物关系、剧情事件、对白、旁白或关键道具。
3. 人物和物品的身份、外观及动作目标必须前后一致；位置、朝向和距离可以按剧情自然变化。普通走位用稳定场景锚点或道具写清起点、经过路径、距离变化、接触范围和最终相对位置；瞬移、闪现、缩地、遁光或空间跃迁保留原有能力设定，写清发动动作、视觉特效、相对目标的落点/朝向/距离和现身环境反馈。道具归属变化必须有明确的交接、抛接、夺取或法术作用过程。
4. 动作按起势、接触、受力、位移、恢复组织；同一主叙事线的连续互动可放在一个时间轴内，平行动作线、角色替换、多次换场才拆成新的 WsShot。
5. 时间轴覆盖完整时长，保持一条清楚的主视觉线。要写清起幅与收幅景别、机位高度、推/拉/摇/移/升降/变焦/移焦的幅度与速度，可在同一镜头内组合多种有动机的运动；并按戏剧重点主动加入一个或多个服务剧情的表情/手部/动作接触/道具特写。不得发展成正反打、无动机多机位碎切、跳时或平行地点。若原始要求有一次大场景变化，必须写清有动机的连续转场动画。
6. 原文有台词、VO、音效或音乐时准确保留；没有则不新增。默认无字幕、贴纸、水印、随机文字和无关背景音乐。
7. 导演约束卡只约束站位、视线、机位和动作关系，不复制灰模材质；分镜板只作为构图、人物关系和画面层次参考，不得据此生成内部剪辑。

${PERFORMANCE_GUIDE}

${AI_DRAMA_BAN}

提交前在内部检查素材编号、人物关系、对白、站位、动作因果、单一机位、连续时空和时间总长。只输出最终版本。`;

function clampDuration(value: number): number {
  return Math.min(180, Math.max(4, Math.round(value || 5)));
}

export async function rewriteUniversalVideoPrompt(
  input: RewriteUniversalVideoPromptInput,
  options: RewriteVideoPromptOptions = {},
): Promise<string> {
  const refs = input.references.length > 0
    ? input.references.map((ref, index) => `${index + 1}. ${ref.label}${ref.kind ? `（${ref.kind}）` : ''}`).join('\n')
    : '无参考素材';
  const duration = clampDuration(input.duration);
  const userPrompt = `输出参数：${duration} 秒，${input.ratio || '16:9'}。

实际提交素材（顺序不可改变）：
${refs}

原始要求：
${input.prompt.trim()}

请先在内部消除重复和冲突，再按通用视频模板输出。严格保留原始剧情事实、人物关系、已有对白和明确动作目标。`;
  // max_tokens 在该端点与 thinking 共享预算（已实测 output_tokens 内含 thinking_tokens），
  // 6000 易被推理占满导致正文截断失败，给到 16000。
  const result = await quickChat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ], { ...options, maxTokens: 16000, continueOnTruncation: true });
  const cleaned = result.trim().replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!cleaned) throw new Error('模型没有返回可用的通用视频提示词');
  const audit = auditUniversalVideoPrompt(cleaned, duration);
  if (audit.errors.length > 0) throw new Error(audit.errors.join('；'));
  return cleaned;
}

export async function rewriteVideoPrompt(
  input: RewriteUniversalVideoPromptInput,
  template: VideoPromptTemplate,
  options: RewriteVideoPromptOptions = {},
): Promise<string> {
  if (template === 'universal') return rewriteUniversalVideoPrompt(input, options);

  const refs = input.references.length > 0
    ? input.references.map((ref, index) => `${index + 1}. ${ref.label}${ref.kind ? `（${ref.kind}）` : ''}`).join('\n')
    : '无参考素材';
  const duration = clampDuration(input.duration);
  const userPrompt = `输出参数：${duration} 秒，${input.ratio || '16:9'}。

实际提交素材（顺序不可改变）：
${refs}

原始要求：
${input.prompt.trim()}

请按经典版详细单镜时间轴结构优化。保留原始剧情事实、人物关系、已有对白、明确动作目标和参考素材编号；只丰富可执行的摄影、表演、光影、材质、声音和时间顺序。只输出一个“镜头1-1”，内部可以写多个前后相继时间段；不得新增并行动作线、角色替换或多次换场。`;
  const result = await quickChat([
    { role: 'system', content: CLASSIC_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ], { ...options, maxTokens: 16000, continueOnTruncation: true });
  const cleaned = result.trim().replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!cleaned) throw new Error('模型没有返回可用的经典版视频提示词');
  return cleaned;
}
