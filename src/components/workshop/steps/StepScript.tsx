import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { importAdProductImages } from '@/lib/workshop/adMaterialFiles';
import { convertFileSrc } from '@tauri-apps/api/tauri';
/**
 * StepScript — ①剧本上传：本地文件复制进 sources/ + 开始拆解。
 */
import { useEffect, useRef, useState } from 'react';
import { Check, FileCheck, FileText, History, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { copyFile, readTextFile, BaseDirectory } from '@tauri-apps/api/fs';
import { useWorkshopStore } from '@/stores/workshopStore';
import { writeProject, type AigcProjectSource } from '@/lib/aigc/projectStore';
import { buildBreakdownPrompt, buildScriptRepairPrompt, buildScriptReviewPrompt } from '@/lib/workshop/workshopPrompts';
import { buildIdeaStoryPlanningPrompt } from '@/lib/workshop/storyDirectorPrompt';
import {
  AD_AUDIENCE_LABEL,
  AD_OBJECTIVE_LABEL,
  AD_PRODUCT_CATEGORY_LABEL,
  buildProductAdPrompt,
  deriveAdDirection,
  type AdAudience,
  type AdCreativeSpec,
  type AdObjective,
  type AdProductCategory,
} from '@/lib/workshop/adSpec';
import { dispatchWorkshopPrompt } from '../WorkshopChatPanel';
import StyleSelector, { buildStyleSection } from '../StyleSelector';

const ACCEPT_EXT = ['docx', 'md', 'txt', 'pdf'];

const DEFAULT_AD_SPEC: AdCreativeSpec = {
  productName: '',
  productCategory: 'physical',
  audience: [],
  objective: 'awareness',
  keyMessage: '',
  durationSec: 60,
  complianceSensitive: false,
};

/** 短剧默认受众选项（与广告受众语义不同，故分开维护）。 */
const DRAMA_AUDIENCE_OPTIONS = ['男频', '女频', '全年龄'];

export default function StepScript() {
  const project = useWorkshopStore((s) => s.project);
  const ideaDraft = useWorkshopStore((s) => s.ideaDraft);
  const ideaAutoGenerate = useWorkshopStore((s) => s.ideaAutoGenerate);
  const clearIdeaGenerationRequest = useWorkshopStore((s) => s.clearIdeaGenerationRequest);
  const scriptRevision = useWorkshopStore((s) => {
    const revisions = s.data?.scriptRevisions ?? [];
    return revisions.find((revision) => revision.id === s.data?.currentScriptRevisionId) ?? revisions[revisions.length - 1];
  });
  const scriptRevisions = useWorkshopStore((s) => s.data?.scriptRevisions ?? []);
  const currentScriptRevisionId = useWorkshopStore((s) => s.data?.currentScriptRevisionId);
  const activateScriptRevision = useWorkshopStore((s) => s.activateScriptRevision);
  const scriptReview = useWorkshopStore((s) => s.data?.scriptReview);
  const markStepStatus = useWorkshopStore((s) => s.markStepStatus);
  const recordScriptRevision = useWorkshopStore((s) => s.recordScriptRevision);
  const [busy, setBusy] = useState(false);
  const idea = ideaDraft;
  const setIdea = useWorkshopStore((s) => s.setIdeaDraft);
  const [ideaBusy, setIdeaBusy] = useState(false);
  const creativeSpec = useWorkshopStore((s) => s.data?.creativeSpec);
  const setCreativeSpec = useWorkshopStore((s) => s.setCreativeSpec);
  const [notice, setNotice] = useState<{ type: 'error' | 'info'; text: string } | null>(null);
  const autoIdeaKey = useRef('');
  const webSearchEnabled = useSettingsStore(s => s.webSearchEnabled);
  const setWebSearchEnabled = useSettingsStore(s => s.setWebSearchEnabled);

  if (!project) return null;

  const persistSources = async (sources: AigcProjectSource[]) => {
    const next = { ...project, sources, updatedAt: Date.now() };
    await writeProject(next);
    useWorkshopStore.setState({ project: next });
  };

  const handlePick = async () => {
    setNotice(null);
    setBusy(true);
    try {
      const selected = await openDialog({
        multiple: true,
        filters: [{ name: '剧本文档', extensions: ACCEPT_EXT }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
    const additions: AigcProjectSource[] = [];
    const revisionContents: string[] = [];
      const skipped: string[] = [];
      const failed: string[] = [];
      for (const p of paths) {
        const base = p.split('/').pop()!;
        if (project.sources.some((s) => s.name === base)) {
          skipped.push(base);
          continue;
        }
        const ext = (base.split('.').pop() ?? 'md').toLowerCase();
        // 复制进项目 sources/，项目目录自包含
        try {
          await copyFile(p, `.gdream/aigc-memory/projects/${project.id}/sources/${base}`, { dir: BaseDirectory.Home });
        } catch {
          failed.push(base);
          continue;
        }
        additions.push({
          name: base,
          type: (['docx', 'md', 'xlsx', 'pdf'].includes(ext) ? ext : 'md') as AigcProjectSource['type'],
          size: 0,
          uploadedAt: Date.now(),
        });
        if (ext === 'md' || ext === 'txt') {
          revisionContents.push(await readTextFile(p).catch(() => ''));
        }
      }
      if (additions.length > 0) {
        await persistSources([...project.sources, ...additions]);
        recordScriptRevision({
          sourceNames: additions.map((source) => source.name),
          sourceKind: 'file',
          content: revisionContents.filter(Boolean).join('\n\n') || undefined,
        });
        markStepStatus('script', 'done');
      }
      if (failed.length > 0) {
        setNotice({ type: 'error', text: `文件复制失败：${failed.join('、')}` });
      } else if (skipped.length > 0) {
        setNotice({ type: 'info', text: `已跳过重复文件：${skipped.join('、')}` });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (name: string) => {
    const remaining = project.sources.filter((s) => s.name !== name);
    await persistSources(remaining);
    const removedCurrentSource = scriptRevision?.sourceNames.includes(name) ?? false;
    if (removedCurrentSource || remaining.length === 0) {
      markStepStatus('script', 'in-progress');
      useWorkshopStore.getState().invalidateDownstream('script');
      useWorkshopStore.getState().logChange('script', `移除剧本源文件：${name}，下游需要重新审核`);
    }
  };

  const effectiveSpec = creativeSpec ?? {
    workKind: 'drama' as const,
    format: 'short-film' as const,
    episodeCount: 1,
    episodeDurationSec: 90,
    detailLevel: 'detailed' as const,
    expansionPolicy: 'balanced' as const,
    allowNewCharacters: true,
    allowSubplots: false,
    allowNewConflicts: true,
    genre: '',
    audience: '',
    tone: '',
    endingType: '',
    outputLanguage: 'zh-CN' as const,
  };

  const patchSpec = (patch: Partial<typeof effectiveSpec>) => setCreativeSpec({ ...effectiveSpec, ...patch });

  const workKind = effectiveSpec.workKind ?? 'drama';
  const adSpec = effectiveSpec.adSpec ?? DEFAULT_AD_SPEC;
  const adDirection = deriveAdDirection(adSpec);
  const patchAdSpec = (patch: Partial<AdCreativeSpec>) =>
    patchSpec({ adSpec: { ...adSpec, ...patch } });

  const toggleAdAudience = (value: AdAudience) => {
    const next = adSpec.audience.includes(value)
      ? adSpec.audience.filter((item) => item !== value)
      : [...adSpec.audience, value];
    patchAdSpec({ audience: next });
  };

  /** 短剧与产品广告共用的落库执行要求，仅第一阶段语义不同。 */
  const breakdownExecutionContract =
    '执行要求：这是工坊第一阶段的直接生成操作。请读取当前工坊状态后，先完成人物目标、冲突、高潮与逐集因果设计，再整理 Scene、Narrative Beat 与角色/场景索引，并在一次 workshop_set_breakdown 调用中同时提交 synopsis、episodes、narrativeBeats、characters、scenes、props；不能只提交梗概、跳过 Narrative Beat 或延后角色/场景字段。每个 Narrative Beat 必须引用已提交的 Scene（sceneId），角色和场景实体必须在同一调用中落库，避免先写概览再补字段。如果当前项目有剧本源文件，再额外提交 sourceEvidence（3-12 条逐字原文短句）；纯 Idea 生成没有原文时不要虚构 sourceEvidence。不要跳转文案工作室，不要创建文案文档，不要要求用户手动导入。写入完成后刷新工坊界面并汇报生成结果。';

  const generateFromIdea = (content: string) => {
    if (workKind === 'product-ad') {
      if (!adSpec.productName.trim()) { setNotice({type:'error',text:'请先填写产品 / 品牌'}); return; }
      if (adSpec.researchMode !== 'provided-only' && (!webSearchEnabled || !resolveApiKey(useSettingsStore.getState(),'tavily',''))) {
        setNotice({type:'error',text:'广告调研需要开启下方「联网」并在设置 > API 凭证绑定 Tavily；或明确选择「仅用已提供资料」。'}); return;
      }
    }
    setIdeaBusy(true);
    const prompt =
      workKind === 'product-ad'
        ? buildProductAdPrompt(content, { ...adSpec, productName: adSpec.productName || '' })
        : `${buildIdeaStoryPlanningPrompt(content, effectiveSpec)}\n\n${breakdownExecutionContract}`;
    dispatchWorkshopPrompt(prompt, { filePaths: workKind === 'product-ad' ? adSpec.productImages : undefined });
    setIdeaBusy(false);
  };

  const handleGenerateFromIdea = () => {
    const content = idea.trim();
    if (!content || ideaBusy) return;
    // 广告链路里「产品 / 品牌」是硬前提：没有它，证据类型与卖点都无从谈起。
    if (workKind === 'product-ad' && !adSpec.productName.trim()) {
      setNotice({ type: 'error', text: '请先填写「产品 / 品牌」再生成广告策略。' });
      return;
    }
    clearIdeaGenerationRequest();
    generateFromIdea(content);
  };

  useEffect(() => {
    if (!ideaAutoGenerate || !ideaDraft || ideaBusy || !project) return;
    const content = ideaDraft.trim();
    if (!content) {
      clearIdeaGenerationRequest();
      return;
    }
    const key = `${project.id}:${content}`;
    if (!content || autoIdeaKey.current === key) return;
    autoIdeaKey.current = key;
    clearIdeaGenerationRequest();
    generateFromIdea(content);
  }, [clearIdeaGenerationRequest, generateFromIdea, ideaAutoGenerate, ideaBusy, ideaDraft, project]);

  return (
    <div className="max-w-[720px] mx-auto px-8 py-8 pb-16">
      <h2 className="text-[16px] font-semibold text-[var(--canvas-text-1)]">{workKind === 'product-ad' ? '① 广告需求与产品资料' : '① 上传剧本'}</h2>
      <p className="text-[12px] text-[var(--canvas-text-3)] mt-1 mb-6">
        支持 docx / md / txt / pdf。上传后由 AI 完成拆解。
      </p>

      <div className="mb-5 rounded-2xl border border-[var(--canvas-node-border)] p-4" style={{ background: 'var(--canvas-node-bg)' }}>
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-[var(--canvas-accent)]" />
          <div>
            <h3 className="text-[14px] font-semibold text-[var(--canvas-text-1)]">
              {workKind === 'product-ad' ? '从创意 brief 开始' : '没有剧本？从初步 Idea 开始'}
            </h3>
            <p className="mt-1 text-[11px] text-[var(--canvas-text-3)]">
              {workKind === 'product-ad'
                ? '调用 product-ad-director 产品广告技能与文本模型：先确定受众、目标与证据类型，再生成广告策略并写入②剧本拆解。'
                : '调用 story-director 故事编排技能和文本模型，生成故事规划并自动保存为正式 Idea 剧本 revision，再写入②剧本拆解。'}
            </p>
          </div>
        </div>
        <textarea
          value={idea}
          onChange={(event) => setIdea(event.target.value)}
          placeholder={workKind === 'product-ad'
            ? '例如：为一款面向年轻人的气泡水做品牌认知广告，主打零糖与真实果味，希望在抖音传播……可补充卖点、禁忌、参考案例。'
            : '例如：一个小和尚第一次下山，在集市帮助迷路的小女孩，最后明白善意不分身份……可补充时长、风格、角色和情绪。'}
          rows={4}
          className="mt-3 w-full resize-y rounded-xl border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.04)] px-3 py-2.5 text-[12px] leading-6 text-[var(--canvas-text-1)] outline-none placeholder:text-[var(--canvas-text-3)] focus:border-[var(--canvas-accent)]"
        />
        {/* 作品大类：短剧走故事链路，产品广告走传播策略链路 */}
        <div className="mt-3">
          <span className="text-[10px] text-[var(--canvas-text-3)]">作品类型</span>
          <div className="mt-1 flex gap-2">
            {([
              ['drama', '短剧 / 影视'],
              ['product-ad', '产品广告'],
            ] as const).map(([value, label]) => {
              const active = workKind === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => patchSpec({ workKind: value })}
                  className="flex-1 rounded-lg border px-3 py-2 text-[11px] transition-colors"
                  style={{
                    borderColor: active ? 'var(--canvas-accent)' : 'var(--canvas-node-border)',
                    color: active ? 'var(--canvas-accent)' : 'var(--canvas-text-2)',
                    background: active ? 'rgba(255,255,255,0.06)' : 'var(--canvas-node-bg)',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {workKind === 'product-ad' ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="col-span-2 mb-4 space-y-2 rounded-lg border border-[var(--canvas-node-border)] p-3">
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                <label><input type="checkbox" checked={webSearchEnabled} onChange={e => setWebSearchEnabled(e.target.checked)} /> 允许联网（Tavily）</label>
                <select aria-label="广告资料来源" value={adSpec.researchMode ?? 'online'} onChange={e => patchAdSpec({researchMode:e.target.value as 'online'|'provided-only',materials:undefined})}
                  className="rounded bg-[var(--canvas-node-bg)] px-2 py-1">
                  <option value="online">联网补充资料和图片</option><option value="provided-only">仅用已提供资料（不联网核实）</option>
                </select>
              </div>
              <button type="button" disabled={busy || (adSpec.productImages?.length ?? 0) >= 4}
                className="text-[12px] text-[var(--canvas-accent)] disabled:opacity-40"
                onClick={async () => {
                  setBusy(true); setNotice(null);
                  try {
                    const selected=await openDialog({multiple:true,filters:[{name:'产品图片',extensions:['png','jpg','jpeg','webp','gif']}]});
                    if(selected) await importAdProductImages(Array.isArray(selected)?selected:[selected]);
                  } catch(error) {setNotice({type:'error',text:error instanceof Error?error.message:'上传失败'});}
                  finally {setBusy(false);}
                }}>＋ 上传产品 / 包装 / 软件界面图片（最多 4 张）</button>
              <p className="text-[10px] text-[var(--canvas-text-3)]">这些图用于锁定真实产品外观，会保存到项目并传给后续分镜生成。网上搜到的图片仅供创意参考，不会自动替换产品图。</p>
              <div className="flex gap-2 flex-wrap">{(adSpec.productImages ?? []).map(path => <div key={path} className="relative">
                <img src={convertFileSrc(path)} alt="产品身份参考" className="h-20 w-20 rounded object-contain" />
                <button type="button" aria-label="移除产品参考图" className="absolute right-0 top-0 bg-black/60 text-white rounded px-1"
                  onClick={() => patchAdSpec({productImages:adSpec.productImages?.filter(p=>p!==path),materials:undefined})}>×</button>
              </div>)}</div>
              {adSpec.materials && <details className="text-[11px]"><summary>本次广告资料：{adSpec.materials.mode==='online'?'联网调研':'仅用已提供资料'}，{adSpec.materials.sources.length} 个来源，{adSpec.materials.images.length} 张参考图</summary>
                {adSpec.materials.sources.map(source=><p key={source.url} className="break-all">{source.title} — {source.url}</p>)}
                <div className="flex gap-2 flex-wrap">{adSpec.materials.images.map(image => <figure key={image.path} className="max-w-40">
                  <img src={convertFileSrc(image.path)} alt="网上检索的创意参考，不是产品身份图" className="h-20 w-32 rounded object-contain" />
                  <figcaption className="break-all text-[10px]">创意参考（授权待确认）：{image.url}</figcaption>
                </figure>)}</div>
                {adSpec.materials.warnings.map(warning=><p key={warning}>{warning}</p>)}
              </details>}
            </div>

              <label className="text-[10px] text-[var(--canvas-text-3)]">产品 / 品牌
                <input
                  value={adSpec.productName}
                  onChange={(event) => patchAdSpec({ productName: event.target.value })}
                  placeholder="如：某新锐气泡水（必填）"
                  className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]"
                />
              </label>
              <label className="text-[10px] text-[var(--canvas-text-3)]">产品形态
                <select
                  value={adSpec.productCategory}
                  onChange={(event) => patchAdSpec({ productCategory: event.target.value as AdProductCategory })}
                  className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]"
                >
                  {(Object.keys(AD_PRODUCT_CATEGORY_LABEL) as AdProductCategory[]).map((key) => (
                    <option key={key} value={key}>{AD_PRODUCT_CATEGORY_LABEL[key]}</option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-[var(--canvas-text-3)]">传播目标
                <select
                  value={adSpec.objective}
                  onChange={(event) => patchAdSpec({ objective: event.target.value as AdObjective })}
                  className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]"
                >
                  {(Object.keys(AD_OBJECTIVE_LABEL) as AdObjective[]).map((key) => (
                    <option key={key} value={key}>{AD_OBJECTIVE_LABEL[key]}</option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-[var(--canvas-text-3)]">目标时长（秒）
                <input
                  type="number"
                  min={5}
                  max={1800}
                  value={adSpec.durationSec}
                  onChange={(event) => patchAdSpec({ durationSec: Math.max(5, Number(event.target.value) || 60) })}
                  className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]"
                />
              </label>
              <label className="col-span-2 text-[10px] text-[var(--canvas-text-3)]">核心卖点 / 诉求
                <input
                  value={adSpec.keyMessage || ''}
                  onChange={(event) => patchAdSpec({ keyMessage: event.target.value })}
                  placeholder="一句话主诉求，留空则由模型从 brief 提炼"
                  className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]"
                />
              </label>
            </div>

            <div className="mt-3">
              <span className="text-[10px] text-[var(--canvas-text-3)]">受众（可多选，混合受众按最保守口径处理）</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {(Object.keys(AD_AUDIENCE_LABEL) as AdAudience[]).map((key) => {
                  const active = adSpec.audience.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleAdAudience(key)}
                      className="rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors"
                      style={{
                        borderColor: active ? 'var(--canvas-accent)' : 'var(--canvas-node-border)',
                        color: active ? 'var(--canvas-accent)' : 'var(--canvas-text-2)',
                        background: active ? 'rgba(255,255,255,0.06)' : 'var(--canvas-node-bg)',
                      }}
                    >
                      {AD_AUDIENCE_LABEL[key]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 推导结果：让用户看到系统如何理解这次广告，而不是黑盒 */}
            <div className="mt-3 rounded-xl border border-[var(--canvas-node-border)] p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <div className="text-[10px] text-[var(--canvas-text-3)]">创意方向（按受众 × 目标自动推导）</div>
              <p className="mt-1 text-[11px] leading-5 text-[var(--canvas-text-2)]">{adDirection.summary}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--canvas-text-3)]">
                <span>证据：{adDirection.primaryProof === 'credential' ? '资质与合规' : adDirection.primaryProof === 'spec' ? '具体参数与事实' : '情绪与记忆点'}</span>
                <span>风险容忍：{adDirection.riskTolerance === 'low' ? '低' : adDirection.riskTolerance === 'medium' ? '中' : '高'}</span>
                {adDirection.requiresHumanReview && <span style={{ color: 'var(--canvas-danger)' }}>需人工终审</span>}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[10px] text-[var(--canvas-text-3)]">题材
                <input value={effectiveSpec.genre || ''} onChange={(event) => patchSpec({ genre: event.target.value })} placeholder="如：都市、古装、悬疑、甜宠" className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]" />
              </label>
              <label className="text-[10px] text-[var(--canvas-text-3)]">目标受众
                <select value={effectiveSpec.audience || ''} onChange={(event) => patchSpec({ audience: event.target.value })} className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]">
                  <option value="">默认</option>
                  {DRAMA_AUDIENCE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-[var(--canvas-text-3)]">故事调性
                <input value={effectiveSpec.tone || ''} onChange={(event) => patchSpec({ tone: event.target.value })} placeholder="如：爽燃、甜虐、搞笑、暗黑" className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]" />
              </label>
              <label className="text-[10px] text-[var(--canvas-text-3)]">结局类型
                <select value={effectiveSpec.endingType || ''} onChange={(event) => patchSpec({ endingType: event.target.value })} className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]">
                  <option value="">默认</option><option value="大团圆">大团圆</option><option value="开放式">开放式</option><option value="反转式">反转式</option><option value="悲剧">悲剧</option>
                </select>
              </label>
              <label className="text-[10px] text-[var(--canvas-text-3)]">输出语言
                <select value={effectiveSpec.outputLanguage || 'zh-CN'} onChange={(event) => patchSpec({ outputLanguage: event.target.value as 'zh-CN' | 'en-US' })} className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]">
                  <option value="zh-CN">中文</option><option value="en-US">English</option>
                </select>
              </label>
              <label className="text-[10px] text-[var(--canvas-text-3)]">作品形式
                <select value={effectiveSpec.format} onChange={(event) => {
                  const format = event.target.value as typeof effectiveSpec.format;
                  patchSpec({ format, episodeCount: format === 'short-film' ? 1 : Math.max(2, effectiveSpec.episodeCount) });
                }} className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]">
                  <option value="short-film">短片</option><option value="short-series">多集短剧</option><option value="slow-drama">慢剧</option><option value="series">连续剧</option>
                </select>
              </label>
              <label className="text-[10px] text-[var(--canvas-text-3)]">计划集数
                <input type="number" min={1} max={200} value={effectiveSpec.episodeCount} onChange={(event) => patchSpec({ episodeCount: Math.max(1, Number(event.target.value) || 1) })} className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]" />
              </label>
              <label className="text-[10px] text-[var(--canvas-text-3)]">单集时长（秒）
                <input type="number" min={15} max={3600} value={effectiveSpec.episodeDurationSec} onChange={(event) => patchSpec({ episodeDurationSec: Math.max(15, Number(event.target.value) || 90) })} className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]" />
              </label>
              <label className="text-[10px] text-[var(--canvas-text-3)]">详细程度
                <select value={effectiveSpec.detailLevel} onChange={(event) => patchSpec({ detailLevel: event.target.value as typeof effectiveSpec.detailLevel })} className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]">
                  <option value="outline">简要大纲</option><option value="standard">标准剧本</option><option value="detailed">详细剧本</option>
                </select>
              </label>
              <label className="col-span-2 text-[10px] text-[var(--canvas-text-3)]">扩写程度
                <select value={effectiveSpec.expansionPolicy} onChange={(event) => patchSpec({ expansionPolicy: event.target.value as typeof effectiveSpec.expansionPolicy })} className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-2 text-[11px] text-[var(--canvas-text-1)]">
                  <option value="conservative">保守补全</option><option value="balanced">平衡扩写</option><option value="free">自由创作</option>
                </select>
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-[var(--canvas-text-2)]">
              {[['allowNewCharacters', '允许新增人物'], ['allowSubplots', '允许新增支线'], ['allowNewConflicts', '允许新增冲突']].map(([key, label]) => <label key={key} className="flex items-center gap-1"><input type="checkbox" checked={effectiveSpec[key as keyof typeof effectiveSpec] as boolean} onChange={(event) => patchSpec({ [key]: event.target.checked })} />{label}</label>)}
            </div>
          </>
        )}
        <button
          onClick={handleGenerateFromIdea}
          disabled={!idea.trim() || ideaBusy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--canvas-accent)' }}
        >
          {ideaBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {ideaBusy
            ? (workKind === 'product-ad' ? '正在生成广告策略…' : '正在生成故事规划…')
            : (workKind === 'product-ad' ? '生成广告策略' : '用 Idea 生成故事规划')}
        </button>
      </div>

      <button
        onClick={() => void handlePick()}
        disabled={busy}
        className="w-full py-10 rounded-2xl border border-dashed border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] hover:border-[var(--canvas-node-border-selected)] hover:text-[var(--canvas-text-1)] transition-colors disabled:opacity-50"
      >
        {busy ? <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> : <Plus size={18} className="mx-auto mb-2" />}
        <span className="text-[13px]">选择剧本文件</span>
      </button>

      {notice && (
        <p
          className="mt-2 text-[12px]"
          style={{ color: notice.type === 'error' ? 'var(--canvas-danger)' : 'var(--canvas-accent)' }}
        >
          {notice.text}
        </p>
      )}

      {(project.sources.length > 0 || Boolean(scriptRevision?.content?.trim())) && (
        <div className="mt-5 space-y-1.5">
          {project.sources.map((s) => (
            <div
              key={s.name}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-[var(--canvas-node-border)]"
              style={{ background: 'var(--canvas-node-bg)' }}
            >
              <FileText size={14} className="text-[var(--canvas-text-2)] shrink-0" />
              <span className="flex-1 text-[12px] text-[var(--canvas-text-1)] truncate">{s.name}</span>
              <span className="text-[10px] text-[var(--canvas-text-3)]">{s.type}</span>
              <button onClick={() => void handleRemove(s.name)} className="p-0.5 rounded text-[var(--canvas-text-3)] hover:text-red-400 transition-colors">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {scriptRevision && (
        <div className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] text-cyan-200">
            <span>当前剧本版本</span>
            <span className="font-mono text-[10px] text-cyan-300/80">{scriptRevision.fingerprint}</span>
          </div>
          <p className="mt-1 text-[10px] text-[var(--canvas-text-3)]">拆解、原子镜头和提示词应基于此版本；重新导入文案会生成新的 revision，不覆盖历史版本。</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--canvas-text-3)]">
            <span className="rounded bg-white/5 px-1.5 py-0.5">Scene/Beat 分段后再拆镜</span>
            <span className="rounded bg-white/5 px-1.5 py-0.5">单镜约 4-6 秒</span>
            <span className="rounded bg-white/5 px-1.5 py-0.5">地点/跳时必须分场</span>
          </div>
          <div className={`mt-2 text-[10px] ${scriptReview?.revisionId === scriptRevision.id && scriptReview.status === 'passed' ? 'text-emerald-300' : scriptReview?.revisionId === scriptRevision.id ? 'text-amber-300' : 'text-[var(--canvas-text-3)]'}`}>
            {scriptReview?.revisionId !== scriptRevision.id
              ? 'Draft Review：尚未完成，开始拆解前会先审核剧本结构'
              : scriptReview.status === 'passed'
                ? `Draft Review：已通过（Scene ${scriptReview.sceneCount} · Beat ${scriptReview.beatCount}）`
                : `Draft Review：需要修订${scriptReview.issues.length ? ` · ${scriptReview.issues.length} 项问题` : ''}`}
          </div>
          {scriptReview?.revisionId === scriptRevision.id && scriptReview.status === 'needs-repair' && scriptReview.issues.length > 0 && (
            <div className="mt-1.5 space-y-0.5 text-[10px] text-amber-200/80">
              {scriptReview.issues.slice(0, 3).map((issue) => <div key={issue}>· {issue}</div>)}
              {scriptReview.issues.length > 3 && <div>· 还有 {scriptReview.issues.length - 3} 项问题</div>}
            </div>
          )}
          {scriptReview?.revisionId === scriptRevision.id && scriptReview.status === 'needs-repair' && (
            <button
              type="button"
              onClick={() => dispatchWorkshopPrompt(buildScriptRepairPrompt())}
              className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-2 text-[11px] text-amber-200 transition-colors hover:bg-amber-500/25"
              title="结合当前剧本和 Draft Review 阻塞项生成新 revision"
            >
              <Sparkles size={12} /> 按审核意见修订剧本
            </button>
          )}
        </div>
      )}

      {(project.sources.length > 0 || Boolean(scriptRevision?.content?.trim())) && (
        <div className="mt-5">
          <p className="text-[11px] text-[var(--canvas-text-3)] mb-2">拆解前先设定全片风格（风格库预设 + 自定义关键词，将注入所有提示词）</p>
          <StyleSelector />
        </div>
      )}

      {(project.sources.length > 0 || Boolean(scriptRevision?.content?.trim())) && (
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            onClick={() => dispatchWorkshopPrompt(buildScriptReviewPrompt())}
            className="flex items-center justify-center gap-2 rounded-xl border border-[var(--canvas-node-border)] py-3 text-[12px] text-[var(--canvas-text-2)] transition-colors hover:border-[var(--canvas-accent)] hover:text-[var(--canvas-text-1)]"
          >
            <FileCheck size={14} /> 检查剧本结构
          </button>
          <button
            onClick={() => void buildStyleSection().then((sec) => dispatchWorkshopPrompt(buildBreakdownPrompt(sec, [], effectiveSpec.format, effectiveSpec.episodeDurationSec)))}
            className="flex items-center justify-center gap-2 rounded-xl py-3 text-[12px] text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--canvas-accent)' }}
          >
            <Sparkles size={14} /> 开始 AI 拆解 →
          </button>
        </div>
      )}

      {scriptRevisions.length > 0 && (
        <div className="mt-6 rounded-2xl border border-[var(--canvas-node-border)] p-4" style={{ background: 'var(--canvas-node-bg)' }}>
          <div className="flex items-center gap-2">
            <History size={15} className="text-[var(--canvas-accent)]" />
            <div>
              <h3 className="text-[13px] font-semibold text-[var(--canvas-text-1)]">剧本版本历史</h3>
              <p className="mt-1 text-[10px] text-[var(--canvas-text-3)]">拆解和正式生成只使用当前冻结版本；切换后需要重新审核与拆解。</p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {[...scriptRevisions].reverse().map((revision) => {
              const active = revision.id === currentScriptRevisionId;
              return (
                <div key={revision.id} className={`rounded-xl border p-3 ${active ? 'border-[var(--canvas-accent)]' : 'border-[var(--canvas-node-border)]'}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-[var(--canvas-text-1)]">{revision.sourceNames.join('、') || '未命名来源'}</span>
                        {active && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--canvas-accent)]/15 px-2 py-0.5 text-[9px] text-[var(--canvas-accent)]"><Check size={10} />当前冻结</span>}
                      </div>
                      <div className="mt-1 text-[9px] text-[var(--canvas-text-3)]">{revision.sourceKind} · {new Date(revision.createdAt).toLocaleString()} · {revision.fingerprint}</div>
                    </div>
                    {!active && (
                      <button
                        onClick={() => activateScriptRevision(revision.id)}
                        disabled={!revision.content?.trim()}
                        title={!revision.content?.trim() ? '该版本没有保存正文快照，不能安全切换' : undefined}
                        className="shrink-0 rounded-lg border border-[var(--canvas-node-border)] px-2 py-1 text-[10px] text-[var(--canvas-text-2)] hover:border-[var(--canvas-accent)] hover:text-[var(--canvas-text-1)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {revision.content?.trim() ? '切换此版本' : '无正文快照'}
                      </button>
                    )}
                  </div>
                  {revision.content?.trim() && <details className="mt-2"><summary className="cursor-pointer text-[10px] text-[var(--canvas-text-3)]">查看版本内容</summary><pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-black/10 p-2 text-[10px] leading-5 text-[var(--canvas-text-2)]">{revision.content}</pre></details>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
