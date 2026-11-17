import { AD_CONTINUITY_RULES } from './adContinuity.ts';
import { AD_RESEARCH_RULES, AD_DELIVERY_RULES } from './adTaskPrompt.ts';
import type { AdMaterials } from './adMaterials.ts';
// ── 产品广告创作规格与创意方向推导 ────────────────────────────────────────────
//
// 设计前提：**不是人群决定广告类型，是「决策成本」决定「证据密度」**。
//
// 政府 / 合作商 / 投资人的决策成本高（走流程、比价、担责），必须给出可验证、
// 可追责的具体证据；大众快销的决策成本低，可以走情绪与记忆点。因此三个轴
// 必须正交：产品类型决定「展示什么」，受众决定「怎么说服」，传播目标决定
// 「怎么收尾」。把它们压成一个「广告类型」下拉框会在混合场景立刻失效。
//
// 关键修正：**抽象程度跟随「目标」，而不是跟随「受众」**。给大众做转化型广告
// （电商 / 下载 / 到店）必须具体到利益点与行动指令，抽象化会直接杀死转化。
// 只有品牌认知型才适合抽象。
//
// 本模块只做确定性推导；真正的创意文案仍由模型生成，运行时不需要 Codex。

/** 作品大类：短剧走原有故事链路，产品广告走本模块的传播策略链路。 */
export type WorkKind = 'drama' | 'product-ad';

/** 产品形态：决定画面里「展示什么」。 */
export type AdProductCategory = 'physical' | 'fmcg' | 'software';

/**
 * 受众：决定「怎么说服」、风险容忍度与禁忌。
 * 可多选；混合受众取最保守的交集。
 */
export type AdAudience = 'government' | 'partner' | 'consumer' | 'investor' | 'employee';

/** 传播目标：决定结构、时长与收尾方式。 */
export type AdObjective = 'awareness' | 'explainer' | 'recruitment' | 'advocacy' | 'conversion';

/** 主要证据类型：用什么让人相信。 */
export type AdProofType = 'credential' | 'spec' | 'feeling';

export interface AdCreativeSpec {
  /** Durable local user-approved product identity references, never replaced by search images. */
  productImages?: string[];
  researchMode?: 'online' | 'provided-only';
  materials?: AdMaterials;
  /** 产品 / 品牌名 */
  productName: string;
  productCategory: AdProductCategory;
  /** 可多选；空数组表示未指定，由模型按 brief 保守推断 */
  audience: AdAudience[];
  objective: AdObjective;
  /** 核心卖点 / 诉求，可为空 */
  keyMessage?: string;
  /** 目标时长（秒）。B2G/B2B 常见 60–180，B2C 常见 15–30。 */
  durationSec: number;
  /** 是否涉及合规敏感内容（政府 / 合作商默认勾选，需人工终审） */
  complianceSensitive?: boolean;
}

export interface AdDirection {
  /** 主要证据类型 */
  primaryProof: AdProofType;
  /** 同时需要呈现的证据类型（混合受众时可能多于一种） */
  allProofs: AdProofType[];
  /** 抽象程度：由传播目标决定，证据类型只做下限约束 */
  abstractLevel: 'concrete' | 'balanced' | 'abstract';
  /** 创作自由度的反向指标：low = 必须严格依据事实，不得发挥 */
  riskTolerance: 'low' | 'medium' | 'high';
  /** 必须承载的信息 */
  mustCarry: string[];
  /** 必须规避的表达 */
  avoid: string[];
  /** 是否需要人工终审（合规兜底） */
  requiresHumanReview: boolean;
  /** 给模型的一句话方向摘要 */
  summary: string;
}

export const AD_AUDIENCE_LABEL: Record<AdAudience, string> = {
  government: '政府 / 监管',
  partner: '合作商 / 渠道',
  consumer: '大众消费者',
  investor: '投资人',
  employee: '内部员工',
};

export const AD_OBJECTIVE_LABEL: Record<AdObjective, string> = {
  awareness: '品牌认知',
  explainer: '产品 / 能力说明',
  recruitment: '招商 / 渠道招募',
  advocacy: '政策 / 价值宣导',
  conversion: '直接转化',
};

export const AD_PRODUCT_CATEGORY_LABEL: Record<AdProductCategory, string> = {
  physical: '实体产品',
  fmcg: '快销品',
  software: '软件 / 服务',
};

const RISK_RANK: Record<AdAudience, number> = {
  government: 0,
  partner: 1,
  investor: 1,
  employee: 2,
  consumer: 3,
};

const RISK_TO_TOLERANCE: AdDirection['riskTolerance'][] = ['low', 'low', 'medium', 'high'];

/** 每个受众默认要求的证据类型（按保守优先排序）。 */
const AUDIENCE_PROOF: Record<AdAudience, AdProofType[]> = {
  government: ['credential'],
  partner: ['spec'],
  investor: ['spec'],
  employee: ['feeling'],
  consumer: ['feeling'],
};

const PROOF_PRIORITY: AdProofType[] = ['credential', 'spec', 'feeling'];

/** 传播目标 → 抽象程度。这是「抽象跟随目标」这一修正的落点。 */
const OBJECTIVE_ABSTRACT: Record<AdObjective, AdDirection['abstractLevel']> = {
  awareness: 'abstract',
  advocacy: 'balanced',
  explainer: 'concrete',
  recruitment: 'concrete',
  conversion: 'concrete',
};

/** 抽象程度下限：证据类型越硬，越不允许纯抽象表达。 */
const PROOF_ABSTRACT_FLOOR: Record<AdProofType, AdDirection['abstractLevel']> = {
  credential: 'balanced',
  spec: 'balanced',
  feeling: 'abstract',
};

const ABSTRACT_ORDER: AdDirection['abstractLevel'][] = ['concrete', 'balanced', 'abstract'];

function moreConcrete(
  a: AdDirection['abstractLevel'],
  b: AdDirection['abstractLevel'],
): AdDirection['abstractLevel'] {
  return ABSTRACT_ORDER.indexOf(a) <= ABSTRACT_ORDER.indexOf(b) ? a : b;
}

/**
 * 由受众 × 目标 × 产品类型推导创意方向。
 *
 * 规则要点：
 * 1. 混合受众取**最保守**的风险等级（安全优先，不被最宽松的受众带跑）。
 * 2. 抽象程度由目标决定，但受主要证据类型约束下限——要拿资质或参数说话时
 *    不能通篇抽象。
 * 3. 产品类型决定「展示什么」：实体看形制与使用场景，快销看感官与复购理由，
 *    软件看问题—解法与真实界面，且**不允许编造参数**。
 */
export function deriveAdDirection(spec: {
  audience: AdAudience[];
  objective: AdObjective;
  productCategory: AdProductCategory;
}): AdDirection {
  const audience = spec.audience.length > 0 ? spec.audience : (['consumer'] as AdAudience[]);

  // 1) 主要证据类型：取最保守的受众；同时收集全部必需证据。
  const allProofs = PROOF_PRIORITY.filter((proof) =>
    audience.some((a) => AUDIENCE_PROOF[a].includes(proof)),
  );
  // 消费者受众叠加目标：转化 / 说明类需要具体证据，认知类才走感觉。
  if (audience.includes('consumer')) {
    const consumerProof: AdProofType =
      spec.objective === 'awareness' || spec.objective === 'advocacy' ? 'feeling' : 'spec';
    if (!allProofs.includes(consumerProof)) allProofs.push(consumerProof);
  }
  const primaryProof =
    PROOF_PRIORITY.find((proof) => allProofs.includes(proof)) ?? 'feeling';

  // 2) 风险容忍度：最保守的受众决定上限。
  const strictest = audience.reduce(
    (acc, a) => Math.min(acc, RISK_RANK[a]),
    Number.POSITIVE_INFINITY,
  );
  const riskTolerance = RISK_TO_TOLERANCE[strictest] ?? 'medium';

  // 3) 抽象程度：目标决定基调，证据类型决定下限。
  const abstractLevel = moreConcrete(
    OBJECTIVE_ABSTRACT[spec.objective],
    PROOF_ABSTRACT_FLOOR[primaryProof],
  );

  // 4) 产品类型决定必须展示什么。
  const productMustCarry: Record<AdProductCategory, string[]> = {
    physical: ['产品形制与材质细节', '真实使用场景', '可验证的功能表现'],
    fmcg: ['感官记忆点（画面或声音）', '消费时刻与使用情境', '复购理由'],
    software: ['问题 → 解法的问题陈述', '真实界面 / 操作过程', '前后对比或可验证结果'],
  };

  // 5) 受众决定必须承载与必须规避的表达。
  const mustCarry: string[] = [...productMustCarry[spec.productCategory]];
  const avoid: string[] = [];

  if (audience.includes('government')) {
    mustCarry.push('合规资质与政策一致性', '社会效益或公共利益');
    avoid.push('夸张承诺', '未经验证的排名或数据', '娱乐化消解严肃议题');
  }
  if (audience.includes('partner')) {
    mustCarry.push('可量化的合作条件（参数 / 毛利 / 履约）');
    avoid.push('只讲品牌情绪不讲具体条款', '模糊的收益承诺');
  }
  if (audience.includes('investor')) {
    mustCarry.push('增长与市场结构的可核查数据');
    avoid.push('无法追溯的数据来源');
  }
  if (audience.includes('consumer')) {
    mustCarry.push('单一核心利益点', '明确的行动指令（CTA）');
    avoid.push('信息过载');
  }
  if (audience.includes('employee')) {
    mustCarry.push('与个人相关的意义感');
  }
  if (spec.productCategory === 'software') {
    avoid.push('编造未实现的功能或性能数字');
  }
  if (spec.objective === 'conversion') {
    avoid.push('只做情绪铺垫而无行动指令');
  }
  if (spec.objective === 'awareness') {
    avoid.push('堆砌参数导致无记忆点');
  }

  const requiresHumanReview =
    audience.includes('government') || audience.includes('partner');

  const audienceText = audience.map((a) => AD_AUDIENCE_LABEL[a]).join(' + ');
  const summary = [
    `受众 ${audienceText}`,
    `目标 ${AD_OBJECTIVE_LABEL[spec.objective]}`,
    `产品 ${AD_PRODUCT_CATEGORY_LABEL[spec.productCategory]}`,
    `→ 以「${primaryProof === 'credential' ? '资质与合规' : primaryProof === 'spec' ? '具体参数与事实' : '情绪与记忆点'}」为主要证据`,
    `抽象程度 ${abstractLevel === 'concrete' ? '具体' : abstractLevel === 'balanced' ? '平衡' : '抽象'}`,
  ].join('；');

  return {
    primaryProof,
    allProofs: PROOF_PRIORITY.filter((p) => allProofs.includes(p)),
    abstractLevel,
    riskTolerance,
    mustCarry: Array.from(new Set(mustCarry)),
    avoid: Array.from(new Set(avoid)),
    requiresHumanReview,
    summary,
  };
}

/**
 * 构建产品广告第一阶段（传播策略）提示词。
 *
 * 与短剧链路的关系：复用同一套 workshop_* 落库契约与下游拆解，只替换第一步的
 * 语义——把「故事开发」换成「传播策略」。因此本函数末尾仍要求写入 synopsis /
 * episodes / narrativeBeats / characters / scenes。
 */
export function buildProductAdPrompt(
  idea: string,
  spec: AdCreativeSpec,
  direction: AdDirection = deriveAdDirection(spec),
): string {
  const audienceText =
    spec.audience.length > 0
      ? spec.audience.map((a) => AD_AUDIENCE_LABEL[a]).join('、')
      : '未指定，请根据 brief 保守推断';

  return `[product-ad-director 产品广告导演技能]
[工坊任务:breakdown]
你是产品广告导演兼创意总监。当前作品大类是**产品广告**，不是短剧。核心是传播与说服，叙事可以作为表达手段：先确定"对谁、证明什么、要求对方做什么"，再设计画面与结构。

## 本次创作规格（必须服从）
- 产品 / 品牌：${spec.productName || '未指定'}
- 产品形态：${AD_PRODUCT_CATEGORY_LABEL[spec.productCategory]}
- 受众：${audienceText}
- 传播目标：${AD_OBJECTIVE_LABEL[spec.objective]}
- 目标时长：约 ${spec.durationSec} 秒
- 核心卖点 / 诉求：${spec.keyMessage || '未指定，请从 brief 提炼一个主诉求'}
- 合规敏感：${spec.complianceSensitive || direction.requiresHumanReview ? '是，成片必须人工终审' : '否'}

- 资料模式：${spec.researchMode === 'provided-only' ? '仅用已提供资料，不得联网' : '联网调研（仍须工具权限和凭证可用）'}
- 用户产品图：${JSON.stringify(spec.productImages ?? [])}

## 受众与目标导向（作为创作依据，结合用户明确要求与可靠资料调整表现方式）
${direction.summary}
- 主要证据类型：${direction.primaryProof === 'credential' ? '资质与合规' : direction.primaryProof === 'spec' ? '具体参数与事实' : '情绪与记忆点'}
- 抽象程度：${direction.abstractLevel === 'concrete' ? '具体——必须给出可验证的事实或利益点' : direction.abstractLevel === 'balanced' ? '平衡——有情绪包装但核心主张必须具体' : '抽象——以情绪与记忆点为主'}
- 风险容忍度：${direction.riskTolerance === 'low' ? '低——严格依据事实，不得发挥' : direction.riskTolerance === 'medium' ? '中——可在事实基础上做包装' : '高——可大胆创意'}
- 建议优先承载（仅在事实和来源支持时使用；缺失时不得编造）：${direction.mustCarry.join('；')}
- 必须规避：${direction.avoid.join('；') || '无特殊禁忌'}

${AD_RESEARCH_RULES}

## 广告结构纪律
- 开场尽快建立与受众相关的信息价值或注意力：可以是痛点、产品演示、结果或可信主张；正式汇报型广告不强套娱乐化钩子。
- 证据段落围绕受众的决策需求；情绪表达不能冒充事实证据，正式或合作场景也不必堆砌无关参数。
- 收尾必须给出与传播目标匹配的动作：${spec.objective === 'conversion' ? '明确 CTA（下单 / 下载 / 到店）' : spec.objective === 'recruitment' ? '明确的接洽入口' : spec.objective === 'awareness' ? '可记忆的品牌符号或口号' : spec.objective === 'advocacy' ? '价值落点与号召' : '清晰的记忆点'}。
- 每个镜头应服务产品理解、情绪记忆或行动目标；允许叙事、幽默和抽象表达，但不为了"电影感"堆砌无关镜头。
- 声音：关键卖点与 CTA 必须标注旁白或字幕意图，不能留给模型猜。

${AD_CONTINUITY_RULES}

${AD_DELIVERY_RULES}

用户输入（创意 brief）：
${idea}`;
}
