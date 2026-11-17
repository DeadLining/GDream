import { QWEN3_TTS_DEFAULT_SPEAKER, QWEN3_TTS_ENGINE, QWEN3_TTS_SAMPLE_TEXT, QWEN3_TTS_SPEAKERS } from '@/lib/qwen3Tts/config';
/**
 * StepAssets — ③资产图：角色设定板 + 场景概念图（一致性锚定）。
 * 卡片 = 图（或空位）+ 提示词 + 生成/重生成 + 本地上传兜底。
 */
import { useEffect, useRef, useState } from 'react';
import { ImageIcon, Loader2, MapPin, Mic, MonitorPlay, MoreHorizontal, Package, Palette, RefreshCw, Sparkles, Trash2, Upload, User, Wand2, X } from 'lucide-react';
import { open as openDialog, confirm } from '@tauri-apps/api/dialog';
import { copyFile, createDir, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useShallow } from 'zustand/react/shallow';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { nanoid } from 'nanoid';
import AssetCandidatesModal from '../AssetCandidatesModal';
import { buildAssetPromptsPrompt, buildVoiceDescPrompt } from '@/lib/workshop/workshopPrompts';
import { dispatchWorkshopPrompt } from '../WorkshopChatPanel';
import StyleSelector, { buildStyleSection } from '../StyleSelector';
import { syncAssetsToCanvas, pullFromCanvas } from '@/lib/workshop/canvasSync';
import SyncMenu from '../SyncMenu';
import SmartTextarea from '../SmartTextarea';
import { useChatStore } from '@/stores';
import { message as tauriMessage } from '@tauri-apps/api/dialog';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import ImageGenerationSettings, { type ImageEngineOption } from '../ImageGenerationSettings';
import { assetBindingIsCurrent } from '@/lib/workshop/assetLineage';
import { buildAssetPromptPlan, type AssetPromptItem } from '@/lib/workshop/assetPrompt';
import type { WorkshopData } from '@/lib/workshop/types';

const GPT_ENGINE: ImageEngineOption = { value: 'gpt-image-2', label: 'GPT', title: 'GPT-Image-2 智能生图通道' };
const SEEDREAM_ENGINE: ImageEngineOption = { value: 'seedream-v5-pro', label: '豆包', title: '豆包 Seedream 5.0 Pro' };
const MIDJOURNEY_V82_ENGINE: ImageEngineOption = { value: 'midjourney-v82', label: 'MJ 8.2', title: 'Midjourney V8.2（APIMart，新版审美，一次返回 4 张候选）' };
const MIDJOURNEY_V81_ENGINE: ImageEngineOption = { value: 'midjourney-v81', label: 'MJ 8.1', title: 'Midjourney V8.1（APIMart 通道，一次返回 4 张候选）' };

export default function StepAssets() {
  // 浅比较对象选择器：只订本页用到的字段；shots 仅用于色卡可见性（shot.colorPaletteId）
  const data = useWorkshopStore(useShallow((s) => s.data && ({
    characters: s.data.characters,
    scenes: s.data.scenes,
    props: s.data.props,
    colorPalettes: s.data.colorPalettes,
    globalColorPaletteId: s.data.globalColorPaletteId,
    shots: s.data.shots,
    assetsStatus: s.data.steps.assets.status,
  })));
  const globalStyle = useWorkshopStore((s) => s.data?.style);
  const workKind = useWorkshopStore((s) => s.data?.creativeSpec?.workKind);
  const markStepStatus = useWorkshopStore((s) => s.markStepStatus);
  const setActiveView = useChatStore((s) => s.setActiveView);

  // 资产图全部就绪后自动标记完成；条件不再满足时把 done 降回 in-progress（不动 stale 等其他状态）
  const allDone = !!data
    && [...data.characters, ...data.scenes, ...(data.props ?? [])].length > 0
    && data.characters.every((c) => c.assetImagePath)
    && data.scenes.every((s) => s.assetImagePath)
    && (data.props ?? []).every((p) => p.assetImagePath);
  const assetsStatus = data?.assetsStatus;
  useEffect(() => {
    if (allDone && assetsStatus !== 'done') markStepStatus('assets', 'done');
    else if (!allDone && assetsStatus === 'done') markStepStatus('assets', 'in-progress');
  }, [allDone, assetsStatus, markStepStatus]);

  if (!data) return null;
  const selectedPaletteIds = new Set([
    data.globalColorPaletteId,
    ...data.shots.map((shot) => shot.colorPaletteId),
  ].filter(Boolean) as string[]);
  const visibleColorPalettes = (data.colorPalettes ?? []).filter((p) => selectedPaletteIds.has(p.id) || p.source !== 'default');

  const handleSyncToCanvas = async () => {
    const msg = await syncAssetsToCanvas();
    await tauriMessage(msg, { title: '同步到画布' });
    setActiveView('canvas');
  };

  const handlePull = async () => {
    const msg = await pullFromCanvas();
    await tauriMessage(msg, { title: '从画布拉取' });
  };

  return (
    <div className="max-w-[980px] mx-auto px-8 py-8 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--canvas-text-1)]">③ 资产图</h2>
          <p className="text-[12px] text-[var(--canvas-text-3)] mt-1">
            角色设定板 + 场景概念图，生成分镜时作为参考图传入（@图片N），锁定全片一致性
          </p>
        </div>
        <div className="flex gap-2">
          <SyncMenu
            onSyncTo={handleSyncToCanvas}
            onPull={handlePull}
            syncToHint="资产图+提示词建为节点，人物一组/场景一组"
            pullHint="画布创作完的图回流到候选集"
          />
          <button
            onClick={() => void buildStyleSection().then((sec) => dispatchWorkshopPrompt(buildAssetPromptsPrompt(sec)))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            <Sparkles size={12} /> AI 写提示词
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--canvas-node-border)] bg-black/10 px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--canvas-text-1)]">
              <Palette size={12} /> 全片画风
            </div>
            <p className="mt-0.5 text-[10px] text-[var(--canvas-text-3)]">
              所有角色、场景和道具都会继承这套画风；角色设定板只吸收色调与气质，不把场景元素带进背景。
            </p>
          </div>
          <span className="max-w-[220px] shrink-0 truncate rounded-full border border-[var(--canvas-node-border)] px-2 py-0.5 text-[10px] text-[var(--canvas-text-3)]" title={globalStyle?.styleLibraryRef || [...(globalStyle?.keywords ?? []), globalStyle?.customText ?? ''].filter(Boolean).join('、') || '未设置画风'}>
            {globalStyle?.styleLibraryRef || [...(globalStyle?.keywords ?? []), globalStyle?.customText ?? ''].filter(Boolean).join('、') || '未设置'}
          </span>
        </div>
        <StyleSelector />
      </div>

      {data.characters.length === 0 && data.scenes.length === 0 && (data.props ?? []).length === 0 ? (
        <p className="text-center py-16 text-[12px] text-[var(--canvas-text-3)]">先完成第②步拆解，角色与场景会自动出现在这里</p>
      ) : (
        <>
          {data.characters.length > 0 && (
            <section className="mt-6">
              <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)] mb-3 flex items-center gap-1.5">
                <User size={13} /> 角色设定板（{data.characters.filter((c) => c.assetImagePath).length}/{data.characters.length}）
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {data.characters.map((c) => (
                  <AssetCard key={c.id} asset={c} globalStyle={globalStyle} workKind={workKind} kind="character" id={c.id} name={c.name} imagePath={c.assetImagePath} prompt={c.assetPrompt} promptMj={c.assetPromptMj} aspect="16/9" engine={c.assetEngine} assetResolution={c.assetResolution} assetAspectRatio={c.assetAspectRatio} candidateCount={c.candidates?.length ?? 0} assetReviewed={Boolean(c.assetImagePath && c.candidates?.some((candidate) => candidate.path === c.assetImagePath && assetBindingIsCurrent({ candidate, binding: c.assetProductionBinding, reviews: c.assetReviews })))} voicePath={c.voicePath} voiceSource={c.voiceSource} />
                ))}
              </div>
            </section>
          )}
          {data.scenes.length > 0 && (
            <section className="mt-6">
              <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)] mb-3 flex items-center gap-1.5">
                <MapPin size={13} /> 场景（{data.scenes.filter((s) => s.assetImagePath).length}/{data.scenes.length}）
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {data.scenes.map((s) => (
                  <AssetCard key={s.id} asset={s} globalStyle={globalStyle} workKind={workKind} kind="scene" id={s.id} name={s.name} imagePath={s.assetImagePath} prompt={s.assetPrompt} promptMj={s.assetPromptMj} aspect="16/9" engine={s.assetEngine} assetResolution={s.assetResolution} assetAspectRatio={s.assetAspectRatio} candidateCount={s.candidates?.length ?? 0} assetReviewed={Boolean(s.assetImagePath && s.candidates?.some((candidate) => candidate.path === s.assetImagePath && assetBindingIsCurrent({ candidate, binding: s.assetProductionBinding, reviews: s.assetReviews })))} />
                ))}
              </div>
            </section>
          )}
          {(data.props ?? []).length > 0 && (
            <section className="mt-6">
              <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)] mb-3 flex items-center gap-1.5">
                <Package size={13} /> 道具（{(data.props ?? []).filter((p) => p.assetImagePath).length}/{(data.props ?? []).length}）
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {(data.props ?? []).map((p) => (
                  <AssetCard key={p.id} asset={p} globalStyle={globalStyle} workKind={workKind} kind="prop" id={p.id} name={p.name} imagePath={p.assetImagePath} prompt={p.assetPrompt} promptMj={p.assetPromptMj} aspect="16/9" engine={p.assetEngine} assetResolution={p.assetResolution} assetAspectRatio={p.assetAspectRatio} candidateCount={p.candidates?.length ?? 0} assetReviewed={Boolean(p.assetImagePath && p.candidates?.some((candidate) => candidate.path === p.assetImagePath && assetBindingIsCurrent({ candidate, binding: p.assetProductionBinding, reviews: p.assetReviews })))} />
                ))}
              </div>
            </section>
          )}
          {visibleColorPalettes.length > 0 && (
            <section className="mt-6">
              <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)] mb-3 flex items-center gap-1.5">
                <Palette size={13} /> 色卡（{visibleColorPalettes.filter((p) => p.assetImagePath).length}/{visibleColorPalettes.length}）
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleColorPalettes.map((p) => (
                  <AssetCard
                    key={p.id}
                    asset={p}
                    globalStyle={globalStyle}
                    workKind={workKind}
                    kind="colorPalette"
                    id={p.id}
                    name={p.name}
                    imagePath={p.assetImagePath}
                    prompt={p.assetPrompt}
                    usagePrompt={p.usagePrompt}
                    colors={p.colors}
                    aspect="16/9"
                    engine={p.assetEngine}
                    assetResolution={p.assetResolution}
                    assetAspectRatio={p.assetAspectRatio}
                    candidateCount={p.candidates?.length ?? 0}
                    isGlobalPalette={data.globalColorPaletteId === p.id}
                    isDefaultPalette={p.source === 'default'}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function AiVoiceButton({ characterId }: { characterId: string }) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState('');
  const [sampleText, setSampleText] = useState(QWEN3_TTS_SAMPLE_TEXT);
  const [speaker, setSpeaker] = useState(() => useWorkshopStore.getState().data?.characters.find((c) => c.id === characterId)?.voiceSpeaker || QWEN3_TTS_DEFAULT_SPEAKER);
  const [generating, setGenerating] = useState(false);
  const pending = useRef(false);

  const handleGenerate = async () => {
    if (pending.current || !sampleText.trim()) return;
    const initial = useWorkshopStore.getState();
    const project = initial.project;
    const character = initial.data?.characters.find((c) => c.id === characterId);
    if (!project || !character) return;
    pending.current = true;
    setGenerating(true);
    try {
      const { generateQwen3VoiceSample } = await import('@/lib/qwen3Tts/client');
      const arr = await generateQwen3VoiceSample({ text: sampleText, instructions: desc, speaker });
      const rel = `.gdream/aigc-memory/projects/${project.id}/assets/voices/${characterId.replace(/[^\w-]+/g, '_')}-qwen3-${nanoid(8)}.wav`;
      await createDir(`.gdream/aigc-memory/projects/${project.id}/assets/voices`, { dir: BaseDirectory.Home, recursive: true });
      const { writeBinaryFile } = await import('@tauri-apps/api/fs');
      await writeBinaryFile(rel, arr, { dir: BaseDirectory.Home });
      const home = await homeDir();
      const voicePath = `${home.replace(/\/$/, '')}/${rel}`;
      const latest = useWorkshopStore.getState();
      const current = latest.data?.characters.find((c) => c.id === characterId);
      if (latest.project?.id !== project.id || !current || current.voicePath !== character.voicePath) {
        await tauriMessage(`音色已生成并保存，但项目或角色音色已变化，未覆盖当前绑定。文件：${voicePath}`, { title: '音色已保存' });
        return;
      }
      latest.setCharacterVoice(characterId, voicePath, 'tts', { engineId: QWEN3_TTS_ENGINE, speaker });
      await useWorkshopStore.getState().commitNow();
      setOpen(false);
    } catch (err) {
      await tauriMessage(`AI 生成音色失败: ${err instanceof Error ? err.message : String(err)}`, { title: '错误' });
    } finally {
      pending.current = false;
      setGenerating(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-[var(--canvas-text-3)] border border-dashed border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-2)] hover:border-[var(--canvas-node-border-selected)] transition-colors">
        <Sparkles size={10} /> AI 生成音色
      </button>
    );
  }

  return (
    <div className="w-full space-y-2 text-[11px] text-[var(--canvas-text-2)]">
      <div className="text-[10px] text-[var(--canvas-text-3)]">Qwen3-TTS CustomVoice · 95 服务 · 预设音色 + 风格控制</div>
      <label className="block">基础音色
        <select value={speaker} disabled={generating} onChange={(e) => setSpeaker(e.target.value)} className="ml-2 rounded border border-[var(--canvas-node-border)] bg-[var(--canvas-bg)] px-2 py-1">
          {QWEN3_TTS_SPEAKERS.map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
        </select>
      </label>
      <label className="block">风格描述（控制语气、节奏与情绪，不作为台词朗读）
        <textarea value={desc} disabled={generating} onChange={(e) => setDesc(e.target.value)} rows={3} maxLength={2000} placeholder="例如：清亮有锋芒，语速明快，自信但不吼叫。可留空使用预设原声。" className="mt-1 w-full px-2 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[var(--canvas-node-border)] focus:outline-none" />
      </label>
      <label className="block">试听台词（只朗读这里的文字）
        <textarea value={sampleText} disabled={generating} onChange={(e) => setSampleText(e.target.value)} rows={2} maxLength={300} className="mt-1 w-full px-2 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[var(--canvas-node-border)] focus:outline-none" />
      </label>
      <div className="flex items-center gap-2">
        <button disabled={generating} onClick={() => dispatchWorkshopPrompt(buildVoiceDescPrompt(characterId, speaker))} className="px-2 py-1 rounded-lg bg-[rgba(255,255,255,0.06)] disabled:opacity-40" title="AI 根据角色特征生成 CustomVoice 风格描述">
          <Wand2 size={10} className="inline mr-0.5" />AI 描述
        </button>
        <button onClick={() => void handleGenerate()} disabled={generating || !sampleText.trim()} className="px-2 py-1 rounded-lg bg-[rgba(255,255,255,0.08)] disabled:opacity-40">
          {generating ? '生成中…' : '生成'}
        </button>
        <button disabled={generating} onClick={() => setOpen(false)} className="p-1.5 rounded disabled:opacity-40" title="关闭"><X size={12} /></button>
      </div>
    </div>
  );
}

function AssetCard({
  asset,
  globalStyle,
  workKind,
  kind,
  id,
  name,
  imagePath,
  prompt,
  promptMj,
  aspect,
  engine,
  assetResolution,
  assetAspectRatio,
  candidateCount,
  assetReviewed,
  voicePath,
  voiceSource,
  usagePrompt,
  isGlobalPalette,
  isDefaultPalette,
  colors,
}: {
  asset: AssetPromptItem;
  globalStyle?: WorkshopData['style'];
  workKind?: string;
  kind: 'character' | 'scene' | 'prop' | 'colorPalette';
  id: string;
  name: string;
  imagePath?: string;
  /** GPT 中文提示词 */
  prompt?: string;
  /** MJ 英文提示词 */
  promptMj?: string;
  aspect: '3/4' | '16/9';
  engine?: string;
  assetResolution?: string;
  assetAspectRatio?: string;
  candidateCount: number;
  assetReviewed?: boolean;
  voicePath?: string;
  voiceSource?: string;
  usagePrompt?: string;
  isGlobalPalette?: boolean;
  isDefaultPalette?: boolean;
  colors?: { hex: string; label: string }[];
}) {
  const setAssetPrompt = useWorkshopStore((s) => s.setAssetPrompt);
  const setAssetImage = useWorkshopStore((s) => s.setAssetImage);
  const setAssetEngine = useWorkshopStore((s) => s.setAssetEngine);
  const setAssetResolution = useWorkshopStore((s) => s.setAssetResolution);
  const setAssetAspectRatio = useWorkshopStore((s) => s.setAssetAspectRatio);
  const generateAsset = useWorkshopStore((s) => s.generateAsset);
  const generateSceneVariants = useWorkshopStore((s) => s.generateSceneVariants);
  const setCharacterVoice = useWorkshopStore((s) => s.setCharacterVoice);
  const removeCharacterVoice = useWorkshopStore((s) => s.removeCharacterVoice);
  const removeCharacter = useWorkshopStore((s) => s.removeCharacter);
  const removeScene = useWorkshopStore((s) => s.removeScene);
  const removeProp = useWorkshopStore((s) => s.removeProp);
  const removeColorPalette = useWorkshopStore((s) => s.removeColorPalette);
  const getAssetRefInfo = useWorkshopStore((s) => s.getAssetRefInfo);
  const setGlobalColorPalette = useWorkshopStore((s) => s.setGlobalColorPalette);
  const setColorPaletteUsagePrompt = useWorkshopStore((s) => s.setColorPaletteUsagePrompt);
  const [generating, setGenerating] = useState(false);
  const [iteratingScene, setIteratingScene] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [promptPlan, setPromptPlan] = useState<Awaited<ReturnType<typeof buildAssetPromptPlan>> | null>(null);
  const activeEngine = engine ?? 'gpt-image-2';
  const isMj = activeEngine.startsWith('midjourney');
  const activeResolution = assetResolution ?? '2k';
  const activeAspectRatio = assetAspectRatio ?? '16:9';
  const ratioOptions = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
  const resolutionOptions = ['1k', '2k', '4k'];

  const handleDelete = async () => {
    if (kind === 'colorPalette') {
      if (!(await confirm(`确认删除 ${name}？`))) return;
      removeColorPalette(id);
      return;
    }
    // 角色/场景/道具是全局级联删除：先展示影响范围，确认后由 store 同步清理分镜引用
    const info = getAssetRefInfo(kind, id);
    const impact = info.shots > 0
      ? `将同步从 ${info.shots} 个分镜中移除引用，并标记这些分镜提示词需刷新。`
      : '没有分镜引用它。';
    const confirmed = await confirm(`删除「${name}」？${impact}`);
    if (!confirmed) return;
    if (kind === 'character') removeCharacter(id);
    else if (kind === 'scene') removeScene(id);
    else removeProp(id);
  };

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      await generateAsset(kind, id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateSceneVariants = async () => {
    if (iteratingScene || kind !== 'scene') return;
    setIteratingScene(true);
    setError(null);
    try {
      await generateSceneVariants(id);
      setModalOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIteratingScene(false);
    }
  };

  const handleUpload = async () => {
    const selected = await openDialog({ filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (!selected || Array.isArray(selected)) return;
    const project = useWorkshopStore.getState().project;
    if (!project) return;
    const ext = selected.split('.').pop() ?? 'png';
    const rel = `.gdream/aigc-memory/projects/${project.id}/assets/${kind}-${id.replace(/[^\w-]+/g, '_')}-up.${ext}`;
    await copyFile(selected, rel, { dir: BaseDirectory.Home });
    const home = await homeDir();
    setAssetImage(kind, id, `${home}${rel}`);
  };

  const handleVoiceUpload = async () => {
    const selected = await openDialog({ filters: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'ogg'] }] });
    if (!selected || Array.isArray(selected)) return;
    const project = useWorkshopStore.getState().project;
    if (!project) return;
    const ext = selected.split('.').pop() ?? 'mp3';
    const rel = `.gdream/aigc-memory/projects/${project.id}/assets/voices/${id.replace(/[^\w-]+/g, '_')}.${ext}`;
    await createDir(`.gdream/aigc-memory/projects/${project.id}/assets/voices`, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
    await copyFile(selected, rel, { dir: BaseDirectory.Home });
    const home = await homeDir();
    setCharacterVoice(id, `${home}${rel}`, 'upload');
  };

  useEffect(() => {
    let cancelled = false;
    void buildAssetPromptPlan({
      kind,
      item: asset,
      engine: activeEngine,
      style: globalStyle,
      workKind,
      hasExistingReference: kind !== 'scene' && Boolean(imagePath),
    }).then((plan) => {
      if (!cancelled) setPromptPlan(plan);
    }).catch(() => {
      if (!cancelled) setPromptPlan(null);
    });
    return () => { cancelled = true; };
  }, [activeEngine, asset, globalStyle, imagePath, kind, workKind]);

  const storedPrompt = isMj ? (promptMj ?? '') : (prompt ?? '');
  const basePromptValue = promptPlan?.usedFallback
    ? promptPlan.basePrompt
    : (storedPrompt.trim() ? storedPrompt : (promptPlan?.basePrompt ?? ''));
  const styleName = promptPlan?.style.name
    ?? globalStyle?.styleLibraryRef
    ?? [...(globalStyle?.keywords ?? []), globalStyle?.customText ?? ''].filter(Boolean).join('、');

  return (
    <div className="rounded-xl border border-[var(--canvas-node-border)] overflow-hidden group relative" style={{ background: 'var(--canvas-node-bg)' }} data-asset-id={id} data-asset-kind={kind}>
      {!isDefaultPalette && !(kind === 'scene' && imagePath) && (
        <button
          onClick={handleDelete}
          className="absolute top-1.5 right-1.5 z-10 p-1 rounded-lg bg-black/60 text-gray-400 hover:text-red-400 opacity-70 hover:opacity-100 transition-all"
          title="删除"
        >
          <Trash2 size={12} />
        </button>
      )}
      <div
        className="relative bg-black/30 flex items-center justify-center cursor-pointer"
        style={{ aspectRatio: aspect }}
        onClick={() => setModalOpen(true)}
        title={kind === 'scene' ? '查看场景资产图' : '点击查看资产图集 / 放大'}
      >
        {imagePath ? (
          <img src={convertFileSrc(imagePath)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : generating ? (
          <Loader2 size={20} className="animate-spin text-[var(--canvas-text-3)]" />
        ) : (
          <ImageIcon size={20} className="text-[var(--canvas-text-3)]" />
        )}
        {kind !== 'scene' && candidateCount > 1 && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px]">
            {candidateCount} 候选
          </span>
        )}
        {imagePath && (
          <span
            className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] ${assetReviewed ? 'bg-emerald-600/85 text-white' : 'bg-amber-600/85 text-white'}`}
            title={assetReviewed ? '当前图已完成资产评审并绑定' : '当前图尚未完成有效资产评审绑定'}
          >
            {assetReviewed ? '已评审' : '待评审'}
          </span>
        )}
        {kind === 'scene' && imagePath && (
          <button
            onClick={(e) => { e.stopPropagation(); void handleGenerateSceneVariants(); }}
            disabled={iteratingScene}
            className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/65 text-white text-[10px] hover:bg-black/85 transition-colors disabled:opacity-50"
            title="重新生成一张场景资产图"
          >
            {iteratingScene ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
            重新生成场景图
          </button>
        )}
        <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); void handleGenerate(); }}
            disabled={generating}
            className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-all opacity-70 hover:opacity-100 disabled:opacity-40"
            title={imagePath ? '重新生成' : '生成'}
          >
            {generating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          </button>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMoreMenuOpen((v) => !v); }}
              className="w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-70 hover:opacity-100 transition-opacity"
              title="更多操作"
            >
              <MoreHorizontal size={12} />
            </button>
            {moreMenuOpen && (
              <>
                <div className="fixed inset-0 z-10 cursor-default" onClick={(e) => { e.stopPropagation(); setMoreMenuOpen(false); }} />
                <div
                  className="absolute bottom-full right-0 mb-1 z-20 min-w-[124px] rounded-lg border border-[var(--canvas-node-border)] py-1 shadow-lg"
                  style={{ background: 'var(--canvas-panel)' }}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); setMoreMenuOpen(false); void handleUpload(); }}
                    className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                  >
                    <Upload size={11} /> 上传本地图替换
                  </button>
                  {imagePath && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMoreMenuOpen(false);
                        const project = useWorkshopStore.getState().project;
                        const { addNode } = useCanvasStore.getState();
                        addNode({
                          id: `node-${nanoid(8)}`,
                          type: 'image',
                          position: { x: 400 + Math.random() * 200, y: 300 + Math.random() * 200 },
                          style: defaultNodeStyle('image'),
                          data: {
                            generatedImageUrl: convertFileSrc(imagePath),
                            localPath: imagePath,
                            description: name,
                            ...(project ? { workshopRef: { projectId: project.id, kind, id, role: 'asset' } } : {}),
                          },
                        });
                      }}
                      className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                    >
                      <MonitorPlay size={11} /> 传到画布
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {kind === 'character' && (
        <div className="border-t border-[var(--canvas-node-border)] px-2.5 py-1 text-[10px] text-[var(--canvas-text-3)]">
          角色一致性母版 · 主立绘 / 正脸 / 正侧背 / 细节参考
        </div>
      )}
      {kind === 'colorPalette' && colors && colors.length > 0 && (
        <div className="flex h-5 border-t border-[var(--canvas-node-border)]">
          {colors.map((c) => (
            <div key={`${id}-${c.hex}-${c.label}`} className="flex-1" style={{ background: c.hex }} title={`${c.hex} ${c.label}`} />
          ))}
        </div>
      )}
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <p className="flex-1 text-[12px] text-[var(--canvas-text-1)] truncate">{name}</p>
          {kind === 'colorPalette' && (
            <button
              onClick={() => setGlobalColorPalette(isGlobalPalette ? undefined : id)}
              className="px-1.5 py-0.5 rounded-md text-[10px] border border-[var(--canvas-node-border)] transition-colors shrink-0"
              style={{
                color: isGlobalPalette ? 'var(--canvas-accent)' : 'var(--canvas-text-3)',
                background: isGlobalPalette ? 'rgba(2,133,255,0.15)' : 'transparent',
              }}
              title={isGlobalPalette ? '取消全片色卡' : '一键用于所有画面'}
            >
              全片
            </button>
          )}
        </div>
        <ImageGenerationSettings
          compact
          engine={activeEngine}
          engineOptions={kind === 'colorPalette' ? [GPT_ENGINE, SEEDREAM_ENGINE] : [GPT_ENGINE, SEEDREAM_ENGINE, MIDJOURNEY_V82_ENGINE, MIDJOURNEY_V81_ENGINE]}
          onEngineChange={(eid) => {
            setAssetEngine(kind, id, eid);
          }}
          ratio={activeAspectRatio}
          ratioOptions={ratioOptions}
          onRatioChange={(ratio) => setAssetAspectRatio(kind, id, ratio)}
          resolution={isMj ? undefined : activeResolution}
          resolutionOptions={resolutionOptions}
          onResolutionChange={(resolution) => setAssetResolution(kind, id, resolution)}
        />
        <div className="mt-1">
          {kind === 'character' && !isMj && prompt && !/角色设定板|三视图|设定图|character design sheet|character bible|three-view/i.test(prompt) && (
            <p className="text-[10px] text-amber-400/90 mb-1">旧版角色提示词，生成时将自动改用角色设定板模板；点上方「AI 写提示词」可更新</p>
          )}
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-[var(--canvas-text-3)]">
            <span>{isMj ? 'MJ 英文基础提示词' : `${activeEngine === 'seedream-v5-pro' ? '豆包 / GPT' : 'GPT'} 中文基础提示词`}</span>
            <span className="min-w-0 truncate text-right" title="基础提示词只描述资产本身；全片画风、视角约束和一致性参考在提交时由系统自动叠加。">
              {styleName ? `画风：${styleName}` : '画风：未设置'}
            </span>
          </div>
          <SmartTextarea
            rows={2}
            value={basePromptValue}
            onChange={(v) => setAssetPrompt(kind, id, v, isMj ? 'mj' : 'gpt')}
            placeholder={kind === 'colorPalette' ? '一张干净的数字色卡参考设计图，16:9 横向构图…' : isMj ? 'character design sheet, front face portrait left, three-view right, ... (English prompt, no --ar)' : '角色设计三视图组合图：左侧正脸肖像大图，右侧三视图…'}
            editorTitle={`${isMj ? 'MJ' : activeEngine === 'seedream-v5-pro' ? '豆包 / GPT' : 'GPT'} 基础提示词 · ${name}`}
            showExpandButton
            className="relative w-full resize-none bg-[rgba(255,255,255,0.03)] rounded-lg px-2 py-1.5 text-[12px] text-[var(--canvas-text-2)] focus:outline-none border border-transparent focus:border-[var(--canvas-node-border-selected)] placeholder:text-[var(--canvas-text-3)]"
          />
          <p className="mt-0.5 text-[10px] text-[var(--canvas-text-3)]">
            {promptPlan?.usedFallback
              ? (promptPlan.legacyCharacterPrompt ? '旧版角色提示词将被角色设定板模板替换；当前显示的是系统兜底模板。' : '当前为空，生成时自动使用这条系统兜底模板。')
              : '此处只保存资产基础描述；全片画风会在提交时自动叠加，不写回这里。'}
          </p>
          {promptPlan && (
            <details className="mt-1 rounded-lg border border-[var(--canvas-node-border)] bg-black/10">
              <summary className="cursor-pointer px-2 py-1 text-[10px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]">
                查看实际提交提示词（已叠加{styleName ? `「${styleName}」` : '当前画风'}与生成约束）
              </summary>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--canvas-node-border)] px-2 py-1.5 text-[10px] leading-relaxed text-[var(--canvas-text-2)]">
                {promptPlan.prompt}
              </pre>
            </details>
          )}
        </div>
        {kind === 'colorPalette' && (
          <div className="mt-1">
            <SmartTextarea
              rows={2}
              value={usagePrompt ?? ''}
              onChange={(v) => setColorPaletteUsagePrompt(id, v)}
              placeholder="画面配色严格参考【@色卡】…"
              editorTitle={`色卡使用提示词 · ${name}`}
              className="w-full resize-none bg-[rgba(255,255,255,0.03)] rounded-lg px-2 py-1.5 text-[12px] text-[var(--canvas-text-2)] focus:outline-none border border-transparent focus:border-[var(--canvas-node-border-selected)] placeholder:text-[var(--canvas-text-3)]"
            />
          </div>
        )}
        {kind === 'character' && (
          <div className="mt-1.5 flex items-center gap-1.5">
            {voicePath ? (
              <>
                <Mic size={10} className="text-[var(--canvas-accent)] shrink-0" />
                <audio src={convertFileSrc(voicePath)} controls className="h-6 flex-1 min-w-0" style={{ maxWidth: '100%' }} />
                <span className="text-[10px] text-[var(--canvas-text-3)] shrink-0">{voiceSource === 'tts' ? 'AI 生成' : voiceSource === 'canvas' ? '画布' : '上传'}</span>
                <button
                  onClick={() => removeCharacterVoice(id)}
                  className="p-1.5 rounded text-[var(--canvas-text-3)] hover:text-red-400 transition-colors shrink-0"
                  title="移除音色"
                >
                  <Trash2 size={12} />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => void handleVoiceUpload()}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-[var(--canvas-text-3)] border border-dashed border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-2)] hover:border-[var(--canvas-node-border-selected)] transition-colors"
                >
                  <Mic size={10} /> 上传音色
                </button>
                <AiVoiceButton characterId={id} />
              </div>
            )}
          </div>
        )}
        {error && <p className="text-[10px] text-red-400 mt-1 line-clamp-2" title={error}>{error}</p>}
      </div>
      {modalOpen && <AssetCandidatesModal kind={kind} id={id} onClose={() => setModalOpen(false)} />}
    </div>
  );
}
