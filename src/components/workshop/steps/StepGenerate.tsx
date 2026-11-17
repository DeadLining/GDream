import { dispatchWorkshopPrompt } from '../WorkshopChatPanel';
import { buildVideoReviewTask, needsVideoEvidenceReview } from '@/lib/workshop/videoReviewTask';
import H3InputModeSelect, { H3ModeChangeNotice, useWorkshopH3Task } from '../H3InputModeSelect';
import { useWorkshopRewriteStore, rewriteIsRunning } from '@/stores/workshopRewriteStore';
import { rewriteWorkshopShotVideo } from '@/lib/workshop/rewriteShotVideo';
/**
 * StepGenerate — ⑤生成：分镜网格，单镜图/视频生成、重生成、取消，
 * 批量补缺失项。并发由 canvasGen MAX 3 槽位队列控制（与画布共享）。
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Clapperboard, ChevronDown, Download, FolderOpen, ImageIcon, Loader2, Maximize2, MonitorPlay, MoreHorizontal, Pause, Play, Plus, RefreshCw, SlidersHorizontal, Sparkles, Trash2, Upload, XCircle, X, FolderOutput } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { invoke } from '@tauri-apps/api/tauri';
import { copyFile, createDir, removeFile, exists, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { confirm as tauriConfirm, message as tauriMessage, open as openDialog } from '@tauri-apps/api/dialog';
import { useShallow } from 'zustand/react/shallow';
import { getSceneReferencePaths, useWorkshopStore } from '@/stores/workshopStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { nanoid } from 'nanoid';
import { ensureVideoThumb, useVideoThumb } from '@/lib/canvas/videoThumbs';
import { MAX_CONCURRENT_CANVAS_TASKS, useCanvasTaskStore } from '@/stores/canvasTaskStore';
import SmartTextarea from '../SmartTextarea';
import ArtifactPickerPanel from '../../canvas/ArtifactPickerPanel';
import ProjectAssetPicker from '../ProjectAssetPicker';
import { buildProjectAssetReferencePatch, projectAssetImages } from '@/lib/workshop/projectAssetReferences';
import type { AssetCandidate, VideoReviewCriteria, WorkshopData, WsShot } from '@/lib/workshop/types';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import { Z, useEscapeClose } from '@/lib/ui/layers';
import {
  applyVideoPlanningReferencePrefixes,
  buildImageRefBindings,
  buildRefAwarePatch,
  buildVideoRefBindings,
  storyboardBoardIsApproved,
  videoPromptForShot,
} from '@/lib/workshop/shotRefs';
import { type VideoPromptTemplate } from '@/lib/videoPrompt/prompt';
import { extractBoundaryFramePromptSegments, normalizeStartFrameDescription, shouldUsePreviousTail } from '@/lib/workshop/shotContinuity';
import { videoCandidateDeletionGuard, videoCandidateFingerprint, boundVideoReview, videoCandidateChoices } from '@/lib/workshop/productionLifecycle';
import { reconcileGenerationStepState } from '@/lib/workshop/stepStatus';
import { qualityReviewMatchesReviewer, qualityReviewerFingerprint, videoQualityReviewForCandidate } from '@/lib/workshop/qualityReview';
import { isMiniMaxH3Model, projectH3SubmissionCounts, projectMiniMaxH3Ref2vaCapabilities, projectProviderCapabilities } from '@/lib/workshop/providerCapabilities';
import ImageFullscreenViewer from '@/components/canvas/ImageFullscreenViewer';
import { prepareSglangH3PromptForTask } from '@/lib/canvasGen/sglangH3';
import { useSettingsStore } from '@/stores/settingsStore';
import { selectH3TaskReferences } from '@/lib/workshop/shotRewriteContext';
import { shotStableSelectionId } from '@/lib/workshop/shotMutation';

import { acceptedVideoTailPath, canInheritAcceptedVideoTail, selectVideoStartFrame } from '@/lib/workshop/inheritedVideoFrame';
import { resolveExistingVideoFrames } from '@/lib/workshop/existingVideoFrames';
import { buildFirstFrameInputPresentation } from '@/lib/workshop/shotInputPresentation';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';

const NUM_TO_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function numToCn(n: number): string { return n <= 10 ? NUM_TO_CN[n - 1] : String(n); }

const VIDEO_RATIOS = ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'];

function videoDownloadName(shot: WsShot): string {
  const sourceName = shot.videoPath?.split('/').pop()?.split('?')[0]?.split('#')[0];
  if (sourceName && /\.(mp4|mov|webm|m4v)$/i.test(sourceName)) return sourceName;
  return `${shot.shotNo.replace(/[^\w-]+/g, '_') || 'video'}.mp4`;
}

function boundaryReferenceUrl(path: string): string {
  return /^(https?:|data:|asset:)/i.test(path) ? path : convertFileSrc(path);
}

function formatPromptRewriteError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b402\b|payment required|insufficient (?:balance|quota)|余额不足|额度不足/i.test(message)) {
    return '当前工坊选择的文本模型额度或余额不足。请在工坊右侧模型选择器切换到另一个已配置的文本模型，或补充该供应商额度后重试。';
  }
  return message;
}

type ShotAssetRef = {
  label: string;
  url: string;
  path: string;
  type?: 'audio' | 'video';
  runtimeBoundary?: boolean;
  removable?: boolean;
  removeKind?: 'scene' | 'character' | 'prop' | 'palette' | 'extra' | 'storyboardBoard' | 'directorConstraintCard' | 'voice' | 'generatedAudio';
  id?: string;
};

/** ShotCard 渲染实际用到的 data 子集；helper 据此收窄，避免整订 data 导致的放大重渲染 */
type ShotVideoContext = Pick<
  WorkshopData,
  'projectId' | 'shots' | 'scenes' | 'characters' | 'props' | 'colorPalettes' | 'globalColorPaletteId' | 'videoModel' | 'videoRatio' | 'videoPromptTemplate'
> & Pick<WorkshopData, 'episodes' | 'narrativeBeats' | 'bibles' | 'style'>;

function effectiveVideoModel(shot: WsShot, data: ShotVideoContext): string {
  return shot.videoModel || data.videoModel || 'seedance-2.0';
}


function effectiveVideoPromptTemplate(
  _shot: WsShot,
  _data: ShotVideoContext,
): VideoPromptTemplate {
  return 'universal';
}

function buildShotVideoRefs(
  shot: WsShot,
  data: ShotVideoContext,
): ShotAssetRef[] {
  const refContext = {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props ?? [],
    colorPalettes: data.colorPalettes ?? [],
    globalColorPaletteId: data.globalColorPaletteId,
  };
  const includeApprovedStoryboardBoards = effectiveVideoModel(shot, data) !== 'seedance-2.5'
    && (shot.storyboardBoards ?? []).some((board) => storyboardBoardIsApproved(shot, board));
  const refs: ShotAssetRef[] = buildVideoRefBindings(shot, refContext, {
    includeStoryboardBoards: includeApprovedStoryboardBoards,
    requireApprovedStoryboardBoards: true,
    includeDirectorConstraintCard: false,
  }).map((binding) => ({
    label: `@图片${numToCn(binding.index)} ${binding.label}`,
    url: convertFileSrc(binding.path),
    path: binding.path,
    removable: true,
    removeKind: binding.kind,
    id: binding.id,
  }));
  const shotIndex = data.shots.findIndex((item) => item.shotNo === shot.shotNo);
  const previousShot = shotIndex > 0 ? data.shots[shotIndex - 1] : undefined;
  const h3Task = useWorkshopStore.getState().getH3InputMode();
  const previousTail = h3Task === 'ref2va' || h3Task === 't2va'
    ? undefined
    : (shouldUsePreviousTail(shot, previousShot) ? previousShot?.videoEndFramePath : undefined);
  if (previousTail) refs.push({
    label: `@图片${numToCn(refs.length + 1)} 上一镜尾帧（连续性）`,
    url: convertFileSrc(previousTail),
    path: previousTail,
    runtimeBoundary: true,
  });
  if (isMiniMaxH3Model(effectiveVideoModel(shot, data))) {
    const startFramePath = selectVideoStartFrame(shot, previousShot, useWorkshopStore.getState().getH3InputMode()).path;
    if (startFramePath) refs.push({
      label: `@图片${numToCn(refs.length + 1)} 当前镜首帧`,
      url: convertFileSrc(startFramePath),
      path: startFramePath,
      runtimeBoundary: true,
    });
    if (shot.videoEndFramePath) refs.push({
      label: `@图片${numToCn(refs.length + 1)} 当前镜尾帧`,
      url: convertFileSrc(shot.videoEndFramePath),
      path: shot.videoEndFramePath,
      runtimeBoundary: true,
    });
  }
  let audioIdx = 1;
  if (shot.audioInjected && shot.generatedAudios?.length) {
    for (const audio of shot.generatedAudios) {
      const path = audio.trimmedPath || audio.path;
      refs.push({ label: `@配音${numToCn(audioIdx)} ${audio.characterName}`, url: convertFileSrc(path), path, type: 'audio', removable: true, removeKind: 'generatedAudio', id: audio.characterId });
      audioIdx++;
    }
  } else {
    for (const cid of (shot.voiceCharacterIds ?? [])) {
      const ch = data.characters.find((c) => c.id === cid);
      if (ch?.voicePath) {
        refs.push({ label: `@音频${numToCn(audioIdx)} ${ch.name}`, url: convertFileSrc(ch.voicePath), path: ch.voicePath, type: 'audio', removable: true, removeKind: 'voice', id: cid });
        audioIdx++;
      }
    }
  }
  return refs;
}

function removeShotRef(ref: ShotAssetRef, shot: WsShot, data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>): Partial<WsShot> | null {
  if (ref.removeKind === 'scene') {
    const active = getSceneReferencePaths(shot, data.scenes);
    return { sceneImagePaths: active.filter((p) => p !== ref.path), promptNeedsRefresh: true };
  }
  if (ref.removeKind === 'character' && ref.id) {
    return {
      characterIds: (shot.characterIds ?? []).filter((id) => id !== ref.id),
      voiceCharacterIds: (shot.voiceCharacterIds ?? []).filter((id) => id !== ref.id),
      audioPrompts: (shot.audioPrompts ?? []).filter((p) => p.characterId !== ref.id),
      generatedAudios: (shot.generatedAudios ?? []).filter((a) => a.characterId !== ref.id),
    };
  }
  if (ref.removeKind === 'prop' && ref.id) return { propIds: (shot.propIds ?? []).filter((id) => id !== ref.id) };
  if (ref.removeKind === 'palette') return { colorPaletteId: '__none__', promptNeedsRefresh: true };
  if (ref.removeKind === 'extra') return { extraRefImages: (shot.extraRefImages ?? []).filter((p) => p !== ref.path) };
  if (ref.removeKind === 'storyboardBoard' && ref.id) return { storyboardBoards: (shot.storyboardBoards ?? []).map((b) => b.id === ref.id ? { ...b, useInVideo: false } : b) };
  if (ref.removeKind === 'directorConstraintCard' && shot.directorConstraintCard) {
    return { directorConstraintCard: { ...shot.directorConstraintCard, useInVideo: false } };
  }
  if (ref.removeKind === 'voice' && ref.id) return { voiceCharacterIds: (shot.voiceCharacterIds ?? []).filter((id) => id !== ref.id) };
  if (ref.removeKind === 'generatedAudio' && ref.id) {
    const nextAudios = (shot.generatedAudios ?? []).filter((a) => a.characterId !== ref.id);
    return { generatedAudios: nextAudios, audioInjected: nextAudios.length > 0 ? shot.audioInjected : false };
  }
  return null;
}

function validateShotPromptForVideo(shot: WsShot, data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>) {
  const model = effectiveVideoModel(shot, data);
  const allRefs = buildShotVideoRefs(shot, data);
  const isH3 = isMiniMaxH3Model(model);
  const h3Task = useWorkshopStore.getState().getH3InputMode();
  const referenceAssetRefs = allRefs.filter((ref) => !ref.runtimeBoundary && !/当前镜(?:首帧|尾帧)/.test(ref.label));
  // Caps must mirror the REAL submission path (buildSglangH3ConditionsForTask):
  //   t2va  -> no conditions
  //   i2va  -> first boundary frame only (frame_index=0)
  //   fl2va -> up to two boundary frames
  //   ref2va-> the reference assets (scene/character/prop/audio/video)
  // The previous code had no i2va branch, so i2va fell through to `allRefs` and
  // counted every asset image, falsely blocking shots at “有 1 类参考素材不支持”.
  const boundaryImageRefs = allRefs.filter((ref) => /当前镜(?:首帧|尾帧)/.test(ref.label));
  const submittedRefs = !isH3
    ? allRefs
    : h3Task === 't2va'
      ? []
      : h3Task === 'i2va'
        ? boundaryImageRefs.filter((ref) => /当前镜首帧/.test(ref.label))
        : h3Task === 'fl2va'
          ? boundaryImageRefs.slice(0, 2)
          : referenceAssetRefs;
  if (isH3 && h3Task === 'ref2va' && submittedRefs.length === 0) {
    return {
      ok: false,
      hard: true,
      message: 'MiniMax-H3 ref2va 至少需要一项实际参考图片、音频或视频。当前镜首帧和尾帧不属于 ref2va conditions，不能代替参考素材。',
    };
  }
  const inputCounts = isH3
    ? projectH3SubmissionCounts({
        task: h3Task,
        boundaryFrameCount: boundaryImageRefs.length,
        assetImageCount: referenceAssetRefs.filter((ref) => !ref.type).length,
        audioCount: referenceAssetRefs.filter((ref) => ref.type === 'audio').length,
        videoCount: referenceAssetRefs.filter((ref) => ref.type === 'video').length,
      })
    : {
        imageCount: submittedRefs.filter((ref) => !ref.type).length,
        audioCount: submittedRefs.filter((ref) => ref.type === 'audio').length,
        videoCount: submittedRefs.filter((ref) => ref.type === 'video').length,
      };
  const capabilityProjection = isH3 && h3Task === 'ref2va'
    ? projectMiniMaxH3Ref2vaCapabilities(inputCounts)
    : projectProviderCapabilities({ engineId: model, ...inputCounts });
  if (!capabilityProjection.canSubmit) return { ok: false, hard: true, message: capabilityProjection.summary };
  return { ok: true, hard: false, message: '' };

}

async function organizeVideos(projectId: string, shots: WsShot[], selectedIds: Set<string>) {
  const home = await homeDir();
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const relDir = `.gdream/aigc-memory/projects/${projectId}/整理-${stamp}`;
  await createDir(relDir, { dir: BaseDirectory.Home, recursive: true });
  const absDir = `${home}${relDir}`;
  let copied = 0;
  for (const shot of shots) {
    if (!selectedIds.has(shotStableSelectionId(shot)) || !shot.videoPath) continue;
    const ext = shot.videoPath.includes('.') ? shot.videoPath.slice(shot.videoPath.lastIndexOf('.')) : '.mp4';
    const safeShotNo = shot.shotNo.replace(/[^\w一-龥-]+/g, '_');
    const destRel = `${relDir}/${safeShotNo}-视频${ext}`;
    await copyFile(shot.videoPath, destRel, { dir: BaseDirectory.Home });
    copied++;
  }
  await tauriMessage(`已整理 ${copied} 个视频到：\n${absDir}`, { title: '整理完成' });
  void invoke('open_path', { path: absDir }).catch(() => {});
}

export default function StepGenerate() {
  // 浅比较对象选择器：只订本页用到的字段，无关 data 写入（changelog/其他步骤状态等）不重渲染
  const data = useWorkshopStore(useShallow((s) => s.data && ({
    projectId: s.data.projectId,
    shots: s.data.shots,
    videoModel: s.data.videoModel,
    videoRatio: s.data.videoRatio,
    videoPromptTemplate: s.data.videoPromptTemplate,
    generateStep: s.data.steps.generate,
    episodes: s.data.episodes,
  })));
  const project = useWorkshopStore((s) => s.project);
  const generateAll = useWorkshopStore((s) => s.generateAll);
  const setVideoRatio = useWorkshopStore((s) => s.setVideoRatio);
  const setVideoModel = useWorkshopStore((s) => s.setVideoModel);

  const markStepStatus = useWorkshopStore((s) => s.markStepStatus);
  const setCurrentStep = useWorkshopStore((s) => s.setCurrentStep);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [organizing, setOrganizing] = useState(false);
  const [selectedEpisodeNo, setSelectedEpisodeNo] = useState('all');
  const visibleShots = !data ? [] : selectedEpisodeNo === 'all'
    ? data.shots
    : data.shots.filter((shot) => shot.episode === selectedEpisodeNo);

  const generateStatus = data?.generateStep.status;
  const reconciledStatus = data && reconcileGenerationStepState(data.shots, data.generateStep).status;
  const allVideosDone = reconciledStatus === 'done';
  useEffect(() => {
    if (reconciledStatus && reconciledStatus !== 'stale' && reconciledStatus !== generateStatus) {
      markStepStatus('generate', reconciledStatus);
    }
  }, [reconciledStatus, generateStatus, markStepStatus]);

  if (!data) return null;

  const imgDone = data.shots.filter((s) => s.imagePath).length;
  const vidDone = data.shots.filter((s) => s.videoPath).length;
  const busy = data.shots.some((s) => s.genStatus === 'queued' || s.genStatus === 'generating');

  const missingRatio = data.shots.filter((s) => !s.videoPath && !s.videoRatio && !data.videoRatio).length;
  const toggleSelect = (shotId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId); else next.add(shotId);
      return next;
    });
  };

  const handleOrganize = async () => {
    if (!project || selected.size === 0 || organizing) return;
    setOrganizing(true);
    try {
      await organizeVideos(project.id, data.shots, selected);
      setSelected(new Set());
    } catch (err) {
      await tauriMessage(`整理失败：${err}`, { title: '错误' });
    } finally {
      setOrganizing(false);
    }
  };

  const handleGenerateAllVideos = async () => {
    const store = useWorkshopStore.getState();
    const latestData = store.data;
    if (!latestData || latestData.shots.some((shot) => shot.genStatus === 'queued' || shot.genStatus === 'generating')) return;
    const targets = latestData.shots.filter((shot) => !shot.videoPath
      && (selectedEpisodeNo === 'all' || shot.episode === selectedEpisodeNo)
      && Boolean(videoPromptForShot(shot, {
        scenes: latestData.scenes,
        characters: latestData.characters,
        props: latestData.props ?? [],
        colorPalettes: latestData.colorPalettes ?? [],
        globalColorPaletteId: latestData.globalColorPaletteId,
      }, {
        template: effectiveVideoPromptTemplate(shot, latestData),
        includeStoryboardBoards: false,
        includeDirectorConstraintCard: false,
      }).trim()));
    if (targets.length === 0) {
      await tauriMessage(selectedEpisodeNo === 'all' ? '没有可生成的视频镜头，请先在第④步写入视频提示词。' : `第 ${selectedEpisodeNo} 集暂无可生成镜头，请先完成本集提示词。`, { title: '暂无生成目标', type: 'warning' });
      return;
    }
    const h3Targets = targets.filter((shot) => isMiniMaxH3Model(effectiveVideoModel(shot, latestData)));
    const frameErrors: string[] = [];
    const task = useWorkshopStore.getState().getH3InputMode();
    for (const shot of h3Targets) {
      try {
        const index = latestData.shots.findIndex((item) => item.shotNo === shot.shotNo);
        await resolveExistingVideoFrames(shot, task, exists, index > 0 ? latestData.shots[index - 1] : undefined);
      } catch (error) {
        frameErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (frameErrors.length > 0) {
      await tauriMessage(
        `有 ${frameErrors.length} 个镜头的已选帧不可用，本次尚未提交任何视频任务。请先准备好所需帧后再批量生成。\n\n${frameErrors.slice(0, 5).join('\n')}${frameErrors.length > 5 ? '\n…' : ''}`,
        { title: '请先准备视频输入帧', type: 'warning' },
      );
      return;
    }
    const confirmed = await tauriConfirm(
      `即将提交 ${targets.length} 个视频生成任务。首帧模式只使用已选首帧，首尾帧模式只使用已选首尾帧；不会自动生成或重做图片。\n\n已生成并绑定的正式视频不会被覆盖；提交后请勿重复点击，状态不确定时只恢复查询。\n\n确认继续吗？`,
      { title: '确认批量生成', type: 'warning' },
    ).catch(() => false);
    if (!confirmed) return;
    const invalid = targets
      .map((shot) => ({ shot, check: validateShotPromptForVideo(shot, latestData) }))
      .filter((item) => !item.check.ok);
    const skipPromptValidation = invalid.length > 0
      ? await tauriConfirm(
          `有 ${invalid.length} 个分镜的视频提示词或素材配置未通过提交前检查。\n\n${invalid.slice(0, 3).map((item) => `${item.shot.shotNo}：${item.check.message}`).join('\n\n')}${invalid.length > 3 ? '\n\n...' : ''}\n\n仍然继续生成吗？`,
          { title: '视频提交检查', type: 'warning' },
        ).catch(() => false)
      : false;
    if (invalid.length > 0 && !skipPromptValidation) return;
    for (const shot of targets) {
      await store.generateShot(shot.shotNo, 'video', { skipPromptValidation });
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto px-8 py-8 pb-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--canvas-text-1)]">⑤ 生成</h2>
          <p className="text-[12px] text-[var(--canvas-text-3)] mt-1">
            当前集分镜图 {visibleShots.filter((s) => s.imagePath).length}/{visibleShots.length} · 视频 {visibleShots.filter((s) => s.videoPath).length}/{visibleShots.length} · 并发上限 {MAX_CONCURRENT_CANVAS_TASKS}（与画布共享队列）
            {missingRatio > 0 && (
              <span className="text-amber-400 ml-2 inline-flex items-center gap-1" title="这些分镜未设置视频比例，无法生成视频">
                <AlertTriangle size={11} /> {missingRatio} 镜未设置视频比例
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {visibleShots.some(needsVideoEvidenceReview) && (
            <button
              onClick={() => dispatchWorkshopPrompt(buildVideoReviewTask(visibleShots.filter(needsVideoEvidenceReview).map(shot => shot.shotNo)))}
              disabled={busy}
              className="rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-400 disabled:opacity-40"
            >DSH 集中审核</button>
          )}
          {selected.size > 0 && (
            <button
              onClick={() => void handleOrganize()}
              disabled={organizing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
            >
              <FolderOutput size={12} />
              整理 {selected.size} 个视频
            </button>
          )}
          <button
            onClick={() => void generateAll('image', true)}
            disabled={busy || visibleShots.length === 0 || visibleShots.every((shot) => shot.imagePath)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors disabled:opacity-40"
          >
            {busy ? (
              <><Loader2 size={12} className="animate-spin" /> 生成中 {imgDone}/{data.shots.length}</>
            ) : (
              <><ImageIcon size={12} /> 补齐分镜图</>
            )}
          </button>
          <button
            onClick={() => void handleGenerateAllVideos()}
            disabled={busy || visibleShots.length === 0 || allVideosDone}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--canvas-accent)' }}
          >
            {busy ? (
              <><Loader2 size={12} className="animate-spin" /> 生成中 {vidDone}/{data.shots.length}</>
            ) : (
              <><Clapperboard size={12} /> 批量生成视频</>
            )}
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--canvas-node-border)] bg-black/15 px-4 py-3">
        <label className="text-[11px] text-[var(--canvas-text-3)]">生成范围</label>
        <select
          value={selectedEpisodeNo}
          onChange={(event) => setSelectedEpisodeNo(event.target.value)}
          className="h-8 min-w-[180px] rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] px-2.5 text-[11px] text-[var(--canvas-text-1)] outline-none"
        >
          <option value="all">全部已准备镜头</option>
          {data.episodes.map((episode) => {
            const count = data.shots.filter((shot) => shot.episode === episode.no).length;
            return <option key={episode.no} value={episode.no}>第 {episode.no} 集（{count} 镜）</option>;
          })}
        </select>
        <span className="text-[10px] text-[var(--canvas-text-3)]">未完成的其他集不会参与本次生成</span>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4 rounded-xl border border-[var(--canvas-node-border)] bg-black/15 px-4 py-3">
        <div className="flex min-w-[130px] items-center gap-2 self-center">
          <SlidersHorizontal size={13} className="text-[var(--canvas-text-2)]" />
          <div>
            <div className="text-[11px] font-medium text-[var(--canvas-text-1)]">视频生成设置</div>
            <div className="text-[10px] text-[var(--canvas-text-3)]">应用于未单独设置的分镜</div>
          </div>
        </div>
        <label className="block min-w-[190px]">
          <span className="mb-1.5 block text-[10px] font-medium text-[var(--canvas-text-3)]">视频模型</span>
          <select
            value={data.videoModel ?? 'seedance-2.0'}
            onChange={(e) => {
              setVideoModel(e.target.value);
            }}
            className="h-9 w-full cursor-pointer rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] px-3 text-[11px] text-[var(--canvas-text-1)] outline-none transition-colors hover:border-[var(--canvas-node-border-selected)] focus:border-[var(--canvas-node-border-selected)]"
          >
            <option value="seedance-2.0">Seedance 2.0</option>
            <option value="seedance-2.5">Seedance 2.5</option>
            <option value="minimax-h3">MiniMax H3</option>
            <option value="seedance-2.0-mini">Seedance 2.0 Mini</option>
            <option value="wan-3.0">万相 3.0</option>
          </select>
        </label>
        <label className="block min-w-[130px]">
          <span className="mb-1.5 block text-[10px] font-medium text-[var(--canvas-text-3)]">全局比例</span>
          <select
            value={data.videoRatio ?? ''}
            onChange={(e) => setVideoRatio(e.target.value)}
            className="h-9 w-full cursor-pointer rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] px-3 text-[11px] text-[var(--canvas-text-1)] outline-none transition-colors hover:border-[var(--canvas-node-border-selected)] focus:border-[var(--canvas-node-border-selected)]"
          >
            <option value="">未设置</option>
            {VIDEO_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        {isMiniMaxH3Model(data.videoModel || '') && <H3InputModeSelect />}
      </div>

      <H3ModeChangeNotice />

      {data.shots.length === 0 ? (
        <div className="mt-5 flex justify-center py-14">
          <div
            className="flex flex-col items-center gap-3 rounded-xl border border-[var(--canvas-node-border)] px-10 py-8 text-center"
            style={{ background: 'var(--canvas-node-bg)' }}
          >
            <Clapperboard size={26} className="text-[var(--canvas-text-3)]" />
            <p className="text-[12px] text-[var(--canvas-text-2)]">还没有分镜，先完成第②步拆解、第④步准备提示词</p>
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={() => setCurrentStep('breakdown')}
                className="px-3 py-1.5 rounded-lg text-[12px] text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--canvas-accent)' }}
              >
                去第②步拆解
              </button>
              <button
                onClick={() => setCurrentStep('prompts')}
                className="px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
              >
                去第④步准备提示词
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleShots.map((shot) => (
            <ShotCard
              key={shotStableSelectionId(shot)}
              shot={shot}
              checked={selected.has(shotStableSelectionId(shot))}
              onToggle={() => toggleSelect(shotStableSelectionId(shot))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShotAudioRow({ audios, limitSec = 15 }: { audios: NonNullable<WsShot['generatedAudios']>; limitSec?: number }) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const totalDuration = audios.reduce((s, a) => s + (a.trimmedDuration ?? a.duration), 0);
  const rounded = Math.round(totalDuration * 10) / 10;

  const play = (id: string, path: string) => {
    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current = null; }
    if (playingId === id) { setPlayingId(null); return; }
    const el = new Audio(convertFileSrc(path));
    el.onended = () => setPlayingId(null);
    el.play();
    audioElRef.current = el;
    setPlayingId(id);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap text-[10px] text-[var(--canvas-text-3)]">
      <span>已生成配音：</span>
      {audios.map((a) => (
        <button
          key={a.characterId}
          onClick={() => play(a.characterId, a.trimmedPath || a.path)}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.06)] hover:text-[var(--canvas-text-1)] transition-colors"
          title={playingId === a.characterId ? '暂停' : '播放'}
        >
          {playingId === a.characterId ? <Pause size={12} /> : <Play size={12} />} {a.characterName} {(a.trimmedDuration ?? a.duration).toFixed(1)}s
        </button>
      ))}
      <span
        className={`inline-flex items-center gap-1 ${rounded > limitSec ? 'text-red-400' : ''}`}
        title={rounded <= limitSec ? `配音总时长未超 ${limitSec}s 限制` : `配音总时长超过 ${limitSec}s，超出视频时长`}
      >
        总计 {rounded}s/{limitSec}s {rounded <= limitSec ? <Check size={12} /> : <AlertTriangle size={12} />}
      </span>
    </div>
  );
}

function ShotCard({ shot, checked, onToggle }: { shot: WsShot; checked: boolean; onToggle: () => void }) {
  // 只订视频生成上下文子集（ShotVideoContext）：分镜文本等无关写入不会让全部卡片重渲染
  const data = useWorkshopStore(useShallow((s) => s.data && ({
    projectId: s.data.projectId,
    shots: s.data.shots,
    videoModel: s.data.videoModel,
    videoRatio: s.data.videoRatio,
    videoPromptTemplate: s.data.videoPromptTemplate,
    scenes: s.data.scenes,
    characters: s.data.characters,
    props: s.data.props,
    colorPalettes: s.data.colorPalettes,
    globalColorPaletteId: s.data.globalColorPaletteId,
    episodes: s.data.episodes,
    narrativeBeats: s.data.narrativeBeats,
    bibles: s.data.bibles,
    style: s.data.style,
  })));
  const generateShot = useWorkshopStore((s) => s.generateShot);
  const selectVideoCandidate = useWorkshopStore((s) => s.selectVideoCandidate);
  const cancelShot = useWorkshopStore((s) => s.cancelShot);
  const updateShot = useWorkshopStore((s) => s.updateShot);
  const commitNow = useWorkshopStore((s) => s.commitNow);
  const videoThumb = useVideoThumb(shot.videoPath);
  const [expanded, setExpanded] = useState(false);
  const [playingVideo, setPlayingVideo] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuPosition, setAddMenuPosition] = useState({ left: 0, top: 0 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectAssetPickerOpen, setProjectAssetPickerOpen] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [localRewriting, setSingleShotRewriting] = useState(false);
  const sharedRewriting = useWorkshopRewriteStore((s) => rewriteIsRunning(s.tasks[`${data?.projectId}:${shot.id}`]?.phase));
  const singleShotRewriting = localRewriting || sharedRewriting;
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewCandidatePath, setPreviewCandidatePath] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<{ title: string; description: string; content: string } | null>(null);
  const [editingStartFramePrompt, setEditingStartFramePrompt] = useState(false);
  const [startFramePromptDraft, setStartFramePromptDraft] = useState('');
  const [reviewCandidate, setReviewCandidate] = useState<{ candidate: AssetCandidate; note: string; criteria: VideoReviewCriteria } | null>(null);

  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const reviewSavingRef = useRef(false);

  // 素材选择器接入 Esc 全局栈：打开时 Esc 只关选择器
  useEscapeClose(pickerOpen, () => setPickerOpen(false));
  useEscapeClose(addMenuOpen, () => setAddMenuOpen(false));
  const taskProgress = useCanvasTaskStore((s) => {
    if (!shot.genTaskId) return undefined;
    return s.tasks.find((t) => t.id === shot.genTaskId)?.progress;
  });

  const openCandidateReview = (candidate: AssetCandidate) => {
    setReviewError(null);
    setReviewCandidate({
      candidate,
      note: '',
      criteria: { continuity: 'not-reviewed', visualIdentity: 'not-reviewed', performance: 'not-reviewed', pacing: 'not-reviewed' },
    });
  };

  const acceptReviewedCandidate = async () => {
    if (!reviewCandidate || reviewSavingRef.current) return;
    reviewSavingRef.current = true;
    setReviewSaving(true);
    setReviewError(null);
    const projectId = data?.projectId;
    try {
      const store = useWorkshopStore.getState();
      if (!projectId || store.data?.projectId !== projectId) throw new Error('项目已切换，请重新打开评审。');
      const path = reviewCandidate.candidate.path;
      const latestShot = store.data.shots.find(item => item.id === shot.id && item.shotNo === shot.shotNo);
      const priorReview = videoQualityReviewForCandidate({
        reports: [latestShot?.videoQualityReview, ...(latestShot?.qualityReviewHistory ?? [])],
        candidatePath:path, candidateFingerprint:videoCandidateFingerprint(reviewCandidate.candidate),
      });
      if (priorReview && !priorReview.passed && priorReview.issues.some(issue => issue.severity === 'error')
        && !reviewCandidate.note.trim()) {
        throw new Error(`该版本有未通过的审核：${priorReview.summary}。如仍用于内部预览，请填写采用原因；这不会使正式交付审核通过。`);
      }
      selectVideoCandidate(shot.shotNo, path, videoCandidateFingerprint(reviewCandidate.candidate), {
        note: reviewCandidate.note.trim() || undefined,
        criteria: reviewCandidate.criteria,
      });
      const current = useWorkshopStore.getState().data?.shots.find(item => item.id === shot.id && item.shotNo === shot.shotNo);
      if (!current || current.genError || current.videoPath !== path || !boundVideoReview(current)) {
        throw new Error(current?.genError || '采用未完成，候选或绑定已变化，请重新核对。');
      }
      await commitNow();
      if (useWorkshopStore.getState().data?.projectId === projectId) setReviewCandidate(null);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : String(error));
    } finally {
      reviewSavingRef.current = false;
      setReviewSaving(false);
    }
  };

  const deleteVideoCandidate = async (candidate: AssetCandidate) => {
    const deletionGuard = videoCandidateDeletionGuard({
      candidates: shot.videoCandidates ?? [],
      path: candidate.path,
      acceptedPath: shot.videoPath,
    });
    if (!deletionGuard.ok) {
      await tauriMessage(deletionGuard.reason, { title: '无法删除候选', type: 'warning' });
      return;
    }
    const confirmed = await tauriConfirm('删除这个视频候选？候选记录和本地视频文件都会被删除，且无法恢复。', {
      title: '删除视频候选',
      type: 'warning',
    });
    if (!confirmed) return;
    const candidateFingerprint = videoCandidateFingerprint(candidate);
    updateShot(shot.shotNo, {
      videoCandidates: (shot.videoCandidates ?? []).filter((item) => item.path !== candidate.path),
      deletedVideoCandidatePaths: Array.from(new Set([
        ...(shot.deletedVideoCandidatePaths ?? []),
        candidate.path,
      ])).slice(-200),
      deletedVideoCandidateIds: candidate.candidateId
        ? Array.from(new Set([
            ...(shot.deletedVideoCandidateIds ?? []),
            candidate.candidateId,
          ])).slice(-200)
        : shot.deletedVideoCandidateIds,
      deletedVideoCandidateNodeIds: candidate.originNodeId
        ? Array.from(new Set([
            ...(shot.deletedVideoCandidateNodeIds ?? []),
            candidate.originNodeId,
          ])).slice(-200)
        : shot.deletedVideoCandidateNodeIds,
      videoReviews: (shot.videoReviews ?? []).filter((item) => item.candidatePath !== candidate.path),
      videoQualityReview: shot.videoQualityReview?.artifactPath === candidate.path
        && shot.videoQualityReview.artifactFingerprint === candidateFingerprint
        ? undefined
        : shot.videoQualityReview,
      qualityReviewHistory: (shot.qualityReviewHistory ?? []).filter((report) => !(
        report.kind === 'video'
        && report.artifactPath === candidate.path
        && report.artifactFingerprint === candidateFingerprint
      )),
    });
    await commitNow();
    const fileDeleteError = await removeFile(candidate.path).then(() => null).catch((error) => error);
    if (previewCandidatePath === candidate.path) setPreviewCandidatePath(null);
    if (fileDeleteError) {
      await tauriMessage(`候选记录已删除，但本地文件删除失败：${fileDeleteError instanceof Error ? fileDeleteError.message : String(fileDeleteError)}`, { title: '文件未删除', type: 'warning' });
    }
  };

  const downloadVideoCandidate = async (path: string, suffix?: string) => {
    try {
      const sourcePath = assetUrlToLocalPath(path);
      if (!sourcePath) throw new Error('视频文件路径无效，无法下载');
      await invoke('save_file_dialog', {
        sourcePath,
        defaultName: suffix ? videoDownloadName(shot).replace(/(\.[^.]+)$/, `-${suffix}$1`) : videoDownloadName(shot),
      });
    } catch (error) {
      await tauriMessage(`下载视频失败：${error instanceof Error ? error.message : String(error)}`, { title: '下载失败', type: 'error' });
    }
  };

  const downloadAcceptedVideo = async () => {
    if (!shot.videoPath) return;
    await downloadVideoCandidate(shot.videoPath);
  };

  const model = data ? effectiveVideoModel(shot, data) : 'seedance-2.0';
  const isSeedance25 = model === 'seedance-2.5';
  const promptTemplate = data ? effectiveVideoPromptTemplate(shot, data) : 'legacy';
  const refContext = data ? { scenes: data.scenes, characters: data.characters, props: data.props ?? [], colorPalettes: data.colorPalettes ?? [], globalColorPaletteId: data.globalColorPaletteId } : null;
  const includeApprovedStoryboardBoards = model !== 'seedance-2.5'
    && (shot.storyboardBoards ?? []).some((board) => storyboardBoardIsApproved(shot, board));
  const displayedVideoPrompt = refContext
      ? videoPromptForShot(shot, refContext, {
          template: promptTemplate,
          includeStoryboardBoards: includeApprovedStoryboardBoards,
          requireApprovedStoryboardBoards: true,
          includeDirectorConstraintCard: false,
          skipPlanningAugmentation: isMiniMaxH3Model(model),
        })
    : promptTemplate === 'universal'
      ? shot.universalVideoPrompt || shot.seedance25VideoPrompt || ''
      : shot.videoPrompt || '';
  const projectH3Task = useWorkshopH3Task();
  const h3Settings = useSettingsStore((settings) => ({
    shortEdge: settings.customVideoGenericH3ShortEdge,
    task: projectH3Task,
    aspectRatio: settings.customVideoGenericH3AspectRatio,
    quality: settings.customVideoGenericH3Quality,
    numOutputs: settings.customVideoGenericH3NumOutputs,
    inferenceSteps: settings.customVideoGenericH3InferenceSteps,
    flowShift: settings.customVideoGenericH3FlowShift,
    audioFlowShift: settings.customVideoGenericH3AudioFlowShift,
    seed: settings.customVideoGenericH3Seed,
    qualityReviewEnabled: settings.qualityReviewEnabled,
    qualityReviewBaseUrl: settings.qualityReviewBaseUrl,
    qualityReviewModel: settings.qualityReviewModel,
  }));

  const refImages = useMemo(() => {
    if (!expanded || !data) return [];
    const allRefs = buildShotVideoRefs(shot, data);
    // The editor must display the same input surface as the provider request.
    // Showing ordinary assets under i2va/fl2va/t2va made it look as though those
    // assets were submitted even though only runtime boundary frames are sent.
    return isMiniMaxH3Model(model)
      ? selectH3TaskReferences(allRefs, h3Settings.task)
      : allRefs;
  }, [expanded, data, shot, model, h3Settings.task]);
  const reviewerFingerprint = qualityReviewerFingerprint(h3Settings.qualityReviewBaseUrl, h3Settings.qualityReviewModel);

  const refreshStartFramePrompt = async () => {
    if (!data) return;
    const segments = extractBoundaryFramePromptSegments(displayedVideoPrompt);
    // Store only the editable visual target. The full wrapper is assembled at
    // generation time; persisting it here would cause recursive duplication.
    const visualTarget = normalizeStartFrameDescription(shot.plannedStartFramePrompt?.trim() || segments.start || shot.description);
    updateShot(shot.shotNo, { plannedStartFramePrompt: visualTarget });
    await commitNow();
    setStartFramePromptDraft(visualTarget);
  };

  const saveStartFramePromptDraft = async () => {
    updateShot(shot.shotNo, { plannedStartFramePrompt: startFramePromptDraft.trim() || undefined });
    await commitNow();
    setEditingStartFramePrompt(false);
  };

  const handlePreviewH3Payload = () => {
    const allConditions = refImages.map((ref, index) => ({
      order: index + 1,
      type: ref.type ?? 'image',
      label: ref.label,
      sourcePath: ref.path,
      uri: ref.path.startsWith('http://') || ref.path.startsWith('https://') || ref.path.startsWith('data:')
        ? ref.path
        : '[运行时从本地源文件编码为 Data URI]',
      ...(ref.type === 'video' ? { start_time_seconds: 0 } : {}),
    }));
    const boundaryConditions = allConditions.filter((condition) => /当前镜(?:首帧|尾帧)/.test(condition.label));
    const conditions = h3Settings.task === 'i2va'
      ? boundaryConditions.slice(0, 1).map((condition) => ({ ...condition, role: 'keyframe', frame_index: 0 }))
      : h3Settings.task === 'fl2va'
      ? boundaryConditions.slice(0, 2).map((condition, index) => ({ ...condition, role: 'keyframe', frame_index: index === 0 ? 0 : -1 }))
      : h3Settings.task === 't2va' ? [] : allConditions.filter((condition) => !/当前镜(?:首帧|尾帧)/.test(condition.label));
    setPreviewText({
      title: 'MiniMax-H3 实际提交快照',
      description: '条件按图片 → 音频 → 视频发送；本地文件的 uri 会在运行时编码为 Data URI，不会映射服务器路径。',
      content: JSON.stringify({
        model: 'MiniMaxAI/MiniMax-H3',
        // H3's endpoint-frame API task is always fl2va; the selected UI mode
        // only controls which keyframe conditions are included.
        task: h3Settings.task === 'i2va' ? 'fl2va' : h3Settings.task,
        prompt: prepareSglangH3PromptForTask(displayedVideoPrompt, h3Settings.task),
        seconds: shot.durationSec ?? 5,
        conditions,
        target: {
          short_edge: h3Settings.shortEdge,
          aspect_ratio: shot.videoRatio || data?.videoRatio || h3Settings.aspectRatio,
          duration_seconds: shot.durationSec ?? 5,
        },
        quality: h3Settings.quality,
        num_outputs_per_prompt: h3Settings.numOutputs,
        num_inference_steps: h3Settings.inferenceSteps,
        flow_shift: h3Settings.flowShift,
        audio_flow_shift: h3Settings.audioFlowShift,
        seed: h3Settings.seed,
      }, null, 2),
    });
  };

  const handleSingleShotRewrite = async () => {
    if (!data || !refContext) {
      await tauriMessage('当前镜头缺少项目参考上下文，无法重写视频提示词。请确认项目已完整打开后重试。', { title: '无法重写', type: 'warning' });
      return;
    }
    if (singleShotRewriting) {
      await tauriMessage('这一镜正在重写，请等待当前任务结束后再试。', { title: '正在重写', type: 'info' });
      return;
    }
    setSingleShotRewriting(true);
    try {
      await rewriteWorkshopShotVideo(data.projectId, shot.shotNo);
    } catch (error) {
      await tauriMessage(`本镜视频提示词重写失败：${formatPromptRewriteError(error)}`, { title: '重写失败', type: 'error' });
    } finally { setSingleShotRewriting(false); }
  };

  const handleUploadRef = async () => {
    const selected = await openDialog({ filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (!selected || Array.isArray(selected)) return;
    const project = useWorkshopStore.getState().project;
    if (!project) return;
    const ext = selected.split('.').pop() ?? 'png';
    const rel = `.gdream/aigc-memory/projects/${project.id}/assets/shot-ref-${shot.shotNo.replace(/[^\w-]+/g, '_')}-${Date.now()}.${ext}`;
    await copyFile(selected, rel, { dir: BaseDirectory.Home });
    const home = await homeDir();
    const absPath = `${home}${rel}`;
    updateShot(shot.shotNo, { extraRefImages: [...(shot.extraRefImages ?? []), absPath] });
    setAddMenuOpen(false);
  };

  const handlePickArtifact = async (entry: { path: string }) => {
    const project = useWorkshopStore.getState().project;
    if (!project) return;
    const ext = entry.path.split('.').pop() ?? 'png';
    const rel = `.gdream/aigc-memory/projects/${project.id}/assets/shot-ref-${shot.shotNo.replace(/[^\w-]+/g, '_')}-lib-${Date.now()}.${ext}`;
    await copyFile(entry.path, rel, { dir: BaseDirectory.Home });
    const home = await homeDir();
    const absPath = `${home}${rel}`;
    updateShot(shot.shotNo, { extraRefImages: [...(shot.extraRefImages ?? []), absPath] });
    setPickerOpen(false);
    setAddMenuOpen(false);
  };

  const handlePickProjectAssets = async (paths: string[]) => {
    const store = useWorkshopStore.getState();
    const latestData = store.data;
    if (!data || latestData?.projectId !== data.projectId) throw new Error('项目已切换，请重新选择资产。');
    const latestShot = latestData.shots.find((item) => shotStableSelectionId(item) === shotStableSelectionId(shot));
    if (!latestShot) throw new Error('当前镜头已不存在，请重新打开镜头。');
    const patch = buildProjectAssetReferencePatch(latestShot, latestData, paths);
    if (Object.keys(patch).length) store.updateShot(latestShot.shotNo, patch);
    await store.commitNow();
  };

  const removeRef = (ref: ShotAssetRef) => {
    const store = useWorkshopStore.getState();
    const latestData = store.data;
    const latestShot = latestData?.shots.find((item) => item.shotNo === shot.shotNo);
    if (!latestData || !latestShot) return;
    const patch = removeShotRef(ref, latestShot, latestData);
    if (!patch) return;
    // 删除参考会移动 @图片N 编号——必须同步重排提示词（曾经裸 updateShot，
    // 删中间一张后提示词残留旧编号，生成时指错素材）
    const ctx = { scenes: latestData.scenes, characters: latestData.characters, props: latestData.props ?? [], colorPalettes: latestData.colorPalettes ?? [], globalColorPaletteId: latestData.globalColorPaletteId };
    const refAwarePatch = buildRefAwarePatch(latestShot, patch, ctx);
    const nextShot = { ...latestShot, ...refAwarePatch, ...patch };
    const planningAssetChanged = ref.removeKind === 'storyboardBoard' || ref.removeKind === 'directorConstraintCard';
    store.updateShot(shot.shotNo, {
      ...refAwarePatch,
      ...patch,
      ...(planningAssetChanged
        ? { videoPrompt: applyVideoPlanningReferencePrefixes(nextShot, refAwarePatch.videoPrompt ?? latestShot.videoPrompt) }
        : {}),
      promptNeedsRefresh: true,
    });
  };

  const validateBeforeVideoAction = async (
    latestShot: WsShot,
    latestData: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>,
  ) => {
    const check = validateShotPromptForVideo(latestShot, latestData);
    if (check.ok) return { proceed: true, skipPromptValidation: false };
    if (check.hard) {
      await tauriMessage(check.message, { title: '视频提交配置不完整', type: 'warning' });
      return { proceed: false, skipPromptValidation: false };
    }
    const skipPromptValidation = await tauriConfirm(
      `这个分镜的视频提示词或素材配置未通过提交前检查。\n\n${check.message}\n\n仍然继续吗？`,
      { title: '视频提交检查', type: 'warning' },
    ).catch(() => false);
    return { proceed: skipPromptValidation, skipPromptValidation };
  };

  const handleGenerateBoundaryFrames = async (
    forceBoundaryFrames: boolean,
    boundaryFrameRole: 'both' | 'start' | 'end' = 'both',
  ) => {
    const store = useWorkshopStore.getState();
    const latestData = store.data;
    const latestShot = latestData?.shots.find((item) => item.shotNo === shot.shotNo);
    if (!latestData || !latestShot) return;
    const index = latestData.shots.findIndex((item) => item.shotNo === latestShot.shotNo);
    const selected = selectVideoStartFrame(latestShot, index > 0 ? latestData.shots[index - 1] : undefined, h3Settings.task);
    if (selected.inherited && boundaryFrameRole !== 'end') {
      const confirmed = await tauriConfirm('当前首帧直接承接上一镜已采用视频的尾帧，可以直接生成视频。重新生图会替换这张首帧并产生生图费用，确定继续吗？', {
        title: '确认替换承接首帧', type: 'warning',
      }).catch(() => false);
      if (!confirmed) return;
    }
    // 此操作只调用生图模型生成 H3 首尾边界帧，不会提交视频任务，也不需要
    // 按 Seedance/ref2va 规则检查视频提示词中的 @图片N 引用。边界帧生成器会
    // 根据真实资产绑定自动构造生图参考和首尾状态提示词。
    await store.generateShot(latestShot.shotNo, 'video', {
      forceBoundaryFrames,
      boundaryFramesOnly: true,
      boundaryFrameRole,
    });
  };

  const handleGenerateVideo = async () => {
    // 始终从 store 读取点击瞬间的分镜，避免展开编辑器或 Agent 刚写回后，
    // React props 尚未完成下一次渲染就拿旧 prompt/旧资产做校验。
    const store = useWorkshopStore.getState();
    const latestData = store.data;
    const latestShot = latestData?.shots.find((item) => item.shotNo === shot.shotNo);
    if (!latestData || !latestShot) return;
    const validation = await validateBeforeVideoAction(latestShot, latestData);
    if (!validation.proceed) return;
    await store.generateShot(latestShot.shotNo, 'video', {
      skipPromptValidation: validation.skipPromptValidation,
    });
  };

  const busy = shot.genStatus === 'queued' || shot.genStatus === 'generating';
  useEffect(() => {
    if (!shot.videoPath || shot.videoThumbPath) return;
    let alive = true;
    void ensureVideoThumb(shot.videoPath).then((thumb) => {
      if (alive && thumb?.path) updateShot(shot.shotNo, { videoThumbPath: thumb.path });
    });
    return () => { alive = false; };
  }, [shot.shotNo, shot.videoPath, shot.videoThumbPath, updateShot]);

  const previousShotIndex = data?.shots.findIndex((item) => item.shotNo === shot.shotNo) ?? -1;
  const previousShot = previousShotIndex > 0 ? data?.shots[previousShotIndex - 1] : undefined;
  const startSelection = selectVideoStartFrame(shot, previousShot, h3Settings.task);
  const effectiveStartFrame = isMiniMaxH3Model(model) ? startSelection.path : shot.videoStartFramePath;
  const persistedVideoThumb = shot.videoThumbPath ? convertFileSrc(shot.videoThumbPath) : null;
  const cover = shot.videoPath
    ? (persistedVideoThumb ?? videoThumb ?? (effectiveStartFrame ? convertFileSrc(effectiveStartFrame) : shot.imagePath ? convertFileSrc(shot.imagePath) : null))
    : effectiveStartFrame ? convertFileSrc(effectiveStartFrame) : shot.imagePath ? convertFileSrc(shot.imagePath) : null;
  const allVideoCandidates = [...(shot.videoCandidates ?? [])].sort((a, b) => a.createdAt - b.createdAt);
  const candidateChoices = videoCandidateChoices(shot.videoCandidates, shot.videoPath);
  const pendingVideoCandidates = [...candidateChoices.newer, ...candidateChoices.history];
  const latestCandidateQualityPassed = true;
  const acceptedVideoCandidate = shot.videoPath
    ? shot.videoCandidates?.find((candidate) => candidate.path === shot.videoPath)
    : undefined;
  const boundaryQualityReviewStale = Boolean(
    h3Settings.qualityReviewEnabled
    && shot.boundaryFrameQualityReview
    && (
      shot.boundaryFrameQualityReviewSignature !== shot.videoBoundaryFrameSignature
      || !qualityReviewMatchesReviewer(shot.boundaryFrameQualityReview, reviewerFingerprint)
    ),
  );
  const reviewedVideoCandidate = shot.videoQualityReview?.artifactPath
    ? shot.videoCandidates?.find((candidate) => candidate.path === shot.videoQualityReview?.artifactPath)
    : undefined;
  const displayedVideoQualityReview = reviewedVideoCandidate
    ? videoQualityReviewForCandidate({
        reports: [shot.videoQualityReview],
        candidatePath: reviewedVideoCandidate.path,
        candidateFingerprint: videoCandidateFingerprint(reviewedVideoCandidate),
        reviewerFingerprint,
      })
    : undefined;
  const videoQualityReviewStale = Boolean(
    h3Settings.qualityReviewEnabled
    && shot.videoQualityReview
    && !displayedVideoQualityReview,
  );
  const firstFrameInputs = data ? buildFirstFrameInputPresentation(shot, previousShot, data, h3Settings.task) : undefined;
  const shotRefs = data ? buildShotVideoRefs(shot, data) : [];
  const boundaryShotRefs = shotRefs.filter((ref) => /当前镜(?:首帧|尾帧)/.test(ref.label));
  const assetShotRefs = shotRefs.filter((ref) => !ref.runtimeBoundary && !/当前镜(?:首帧|尾帧)/.test(ref.label));
  const submittedShotRefs = isMiniMaxH3Model(model)
    ? h3Settings.task === 'i2va'
      ? boundaryShotRefs.filter((ref) => /当前镜首帧/.test(ref.label))
      : h3Settings.task === 'fl2va'
        ? boundaryShotRefs.slice(0, 2)
        : h3Settings.task === 'ref2va'
          ? assetShotRefs
          : []
    : shotRefs;
  const submittedInputCounts = isMiniMaxH3Model(model)
    ? projectH3SubmissionCounts({
        task: h3Settings.task,
        boundaryFrameCount: boundaryShotRefs.length,
        assetImageCount: assetShotRefs.filter((ref) => !ref.type).length,
        audioCount: assetShotRefs.filter((ref) => ref.type === 'audio').length,
        videoCount: assetShotRefs.filter((ref) => ref.type === 'video').length,
      })
    : {
        imageCount: submittedShotRefs.filter((ref) => !ref.type).length,
        audioCount: submittedShotRefs.filter((ref) => ref.type === 'audio').length,
        videoCount: submittedShotRefs.filter((ref) => ref.type === 'video').length,
      };
  const capabilityProjection = isMiniMaxH3Model(model) && h3Settings.task === 'ref2va'
    ? projectMiniMaxH3Ref2vaCapabilities(submittedInputCounts)
    : projectProviderCapabilities({ engineId: model, ...submittedInputCounts });
  const ref2vaMissingReferences = isMiniMaxH3Model(model)
    && h3Settings.task === 'ref2va'
    && submittedShotRefs.length === 0;
  const capabilitySummary = capabilityProjection.summary;
  const canSubmitVideo = capabilityProjection.canSubmit;

  return (
    <div className={`rounded-xl border overflow-hidden group ${shot.genStatus === 'failed' ? 'border-red-500/60' : 'border-[var(--canvas-node-border)]'}`} style={{ background: 'var(--canvas-node-bg)' }} data-shot-no={shot.shotNo}>
      <div className="relative aspect-video bg-black/30 flex items-center justify-center">
        {playingVideo && shot.videoPath ? (
          <video
            src={convertFileSrc(shot.videoPath)}
            autoPlay
            controls
            className="w-full h-full object-contain bg-black"
            onEnded={() => setPlayingVideo(false)}
          />
        ) : cover ? (
          <img src={cover} alt="" className="w-full h-full object-cover" />
        ) : pendingVideoCandidates.length > 0 ? (
          <div className="flex flex-col items-center gap-1 text-[11px] text-amber-300">
            <Clapperboard size={20} />
            <span>已有视频候选，待评审</span>
          </div>
        ) : busy ? null : (
          <ImageIcon size={18} className="text-[var(--canvas-text-3)]" />
        )}
        {shot.videoPath && !playingVideo && (
          <button
            onClick={() => setPlayingVideo(true)}
            className="absolute inset-0 flex items-center justify-center"
          >
            <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors">
              <Play size={18} className="text-white ml-0.5" fill="white" />
            </div>
          </button>
        )}
        {shot.genStatus === 'failed' && (
          <span
            className="absolute top-1.5 left-1.5 w-5 h-5 rounded bg-black/60 flex items-center justify-center"
            title={shot.genError ?? '生成失败'}
          >
            <AlertTriangle size={11} className="text-red-400" />
          </span>
        )}
        {shot.videoPath && !playingVideo && (
          <span className={`absolute top-1.5 ${shot.genStatus === 'failed' ? 'left-8' : 'left-1.5'} px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] flex items-center gap-1`}>
            <Play size={8} /> 视频
          </span>
        )}
        {busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50">
            <Loader2 size={18} className="animate-spin text-white" />
            <span className="text-[10px] text-white/80">{taskProgress || shot.genProgress || (shot.genStatus === 'queued' ? '排队中…' : '生成中…')}</span>
            <button
              onClick={() => cancelShot(shot.shotNo)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-white/70 hover:text-white transition-colors"
            >
              <XCircle size={10} /> 取消
            </button>
          </div>
        )}
        {!busy && (
          <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
            {isMiniMaxH3Model(model) && ['i2va', 'fl2va'].includes(h3Settings.task) && (
              <>
                {h3Settings.task === 'fl2va' && (
                  <button
                    onClick={() => void handleGenerateBoundaryFrames(Boolean(effectiveStartFrame && shot.videoEndFramePath))}
                    disabled={!shot.videoRatio && !data?.videoRatio}
                    className="px-2 py-1 rounded-lg bg-black/65 text-white text-[10px] transition-opacity opacity-80 hover:opacity-100 flex items-center gap-1 disabled:opacity-40"
                    title={(shot.videoRatio || data?.videoRatio)
                      ? effectiveStartFrame && shot.videoEndFramePath
                        ? '根据完整动作时间轴、首尾状态和跨镜连续性重新生成首尾帧'
                        : '根据完整动作时间轴、首尾状态和跨镜连续性生成首尾帧'
                      : '请先设置视频比例'}
                  >
                    {effectiveStartFrame && shot.videoEndFramePath ? <RefreshCw size={10} /> : <ImageIcon size={10} />}
                    {effectiveStartFrame && shot.videoEndFramePath
                      ? '重做首尾帧'
                      : effectiveStartFrame || shot.videoEndFramePath
                        ? '继续首尾帧'
                        : '生成首尾帧'}
                  </button>
                )}
                {h3Settings.task !== 'ref2va' && h3Settings.task !== 't2va' && <button
                  onClick={() => void handleGenerateBoundaryFrames(true, 'start')}
                  disabled={!shot.videoRatio && !data?.videoRatio}
                  className="px-2 py-1 rounded-lg bg-black/65 text-white text-[10px] transition-opacity opacity-80 hover:opacity-100 flex items-center gap-1 disabled:opacity-40"
                  title={(shot.videoRatio || data?.videoRatio) ? '只根据资产、上一镜尾帧和当前镜头首状态生成首帧，不生成视频' : '请先设置视频比例'}
                >
                  {effectiveStartFrame ? <RefreshCw size={10} /> : <ImageIcon size={10} />}
                  {effectiveStartFrame ? '重做首帧' : '生成首帧'}
                </button>}
                {h3Settings.task === 'fl2va' && (
                  <button
                    onClick={() => void handleGenerateBoundaryFrames(true, 'end')}
                    disabled={(!shot.videoRatio && !data?.videoRatio) || !effectiveStartFrame}
                    className="px-2 py-1 rounded-lg bg-black/65 text-white text-[10px] transition-opacity opacity-80 hover:opacity-100 flex items-center gap-1 disabled:opacity-40"
                    title={!(shot.videoRatio || data?.videoRatio)
                      ? '请先设置视频比例'
                      : !effectiveStartFrame
                        ? '请先生成首帧，再单独生成尾帧'
                        : shot.videoEndFramePath
                          ? '保留当前首帧，只根据最新提示词和完整时间轴重做尾帧'
                          : '保留当前首帧，根据最新提示词和完整时间轴生成尾帧'}
                  >
                    {shot.videoEndFramePath ? <RefreshCw size={10} /> : <ImageIcon size={10} />}
                    {shot.videoEndFramePath ? '重做尾帧' : '生成尾帧'}
                  </button>
                )}
              </>
            )}
              <button
                onClick={() => void handleGenerateVideo()}
                disabled={(!shot.videoRatio && !data?.videoRatio)
                || (isMiniMaxH3Model(model) && h3Settings.task === 'i2va' && !effectiveStartFrame)
                || (isMiniMaxH3Model(model) && h3Settings.task === 'fl2va' && (!effectiveStartFrame || !shot.videoEndFramePath))
                || ref2vaMissingReferences}
              className="px-2 py-1 rounded-lg text-white text-[10px] transition-opacity opacity-70 hover:opacity-100 flex items-center gap-1 disabled:opacity-40"
              style={{ background: 'var(--canvas-accent)' }}
              title={!(shot.videoRatio || data?.videoRatio)
                ? '请先设置视频比例'
                : isMiniMaxH3Model(model) && h3Settings.task === 'i2va' && !effectiveStartFrame
                  ? (previousShot?.videoPath && canInheritAcceptedVideoTail(shot, previousShot) ? '等待上一镜已采用视频的尾帧截图，无需生成首尾帧' : 'i2va 请先生成首帧')
                : isMiniMaxH3Model(model) && h3Settings.task === 'fl2va' && (!effectiveStartFrame || !shot.videoEndFramePath)
                  ? '请先生成首尾帧'
                  : ref2vaMissingReferences
                    ? 'ref2va 至少需要一项实际参考图片、音频或视频；当前镜首尾帧不计入 conditions'
                  : shot.videoPath ? '重新生成视频' : '生成视频'}
            >
              {shot.videoPath ? <RefreshCw size={10} /> : <Clapperboard size={10} />} 视频
            </button>
            <div className="relative">
              <button
                onClick={() => setMoreMenuOpen((v) => !v)}
                className="w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-70 hover:opacity-100 transition-opacity"
                title="更多操作"
              >
                <MoreHorizontal size={12} />
              </button>
              {moreMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10 cursor-default" onClick={() => setMoreMenuOpen(false)} />
                  <div
                    className="absolute bottom-full right-0 mb-1 z-20 min-w-[124px] rounded-lg border border-[var(--canvas-node-border)] py-1 shadow-lg"
                    style={{ background: 'var(--canvas-panel)' }}
                  >
                    <button
                      onClick={() => { setMoreMenuOpen(false); void generateShot(shot.shotNo, 'image'); }}
                      className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                    >
                      {shot.imagePath ? <RefreshCw size={11} /> : <ImageIcon size={11} />} {shot.imagePath ? '重新生成分镜图' : '生成分镜图'}
                    </button>
                    {shot.imagePath && (
                      <button
                        onClick={() => {
                          setMoreMenuOpen(false);
                          const { addNode } = useCanvasStore.getState();
                          addNode({
                            id: `node-${nanoid(8)}`,
                            type: 'image',
                            position: { x: 400 + Math.random() * 200, y: 300 + Math.random() * 200 },
                            style: defaultNodeStyle('image'),
                            data: { generatedImageUrl: convertFileSrc(shot.imagePath!), localPath: shot.imagePath, description: shot.description },
                          });
                        }}
                        className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                      >
                        <MonitorPlay size={11} /> 图→画布
                      </button>
                    )}
                    {shot.videoPath && (
                      <button
                        onClick={() => { setMoreMenuOpen(false); void downloadAcceptedVideo(); }}
                        className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                      >
                        <Download size={11} /> 下载已采用视频
                      </button>
                    )}
                    {shot.videoPath && (
                      <button
                        onClick={() => {
                          setMoreMenuOpen(false);
                          const { addNode } = useCanvasStore.getState();
                          addNode({
                            id: `node-${nanoid(8)}`,
                            type: 'video',
                            position: { x: 400 + Math.random() * 200, y: 300 + Math.random() * 200 },
                            style: defaultNodeStyle('video'),
                            data: {
                              generatedVideoUrl: convertFileSrc(shot.videoPath!),
                              localPath: shot.videoPath,
                              mediaRole: 'output',
                              description: shot.description,
                            },
                          });
                        }}
                        className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                      >
                        <Clapperboard size={11} /> 视频→画布
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className={`px-2 py-1 text-[10px] ${canSubmitVideo ? 'text-emerald-300/80' : 'text-amber-300'}`} title={capabilitySummary}>
        能力投影：{capabilitySummary}
        <div className="mt-1 flex flex-wrap gap-1">
          {capabilityProjection.items.filter((item) => item.count > 0).map((item) => {
            const label = item.kind === 'image' ? '图片' : item.kind === 'audio' ? '音频' : '视频';
            const tone = item.status === 'native'
              ? 'border-emerald-400/30 text-emerald-300/90'
              : item.status === 'degraded'
                ? 'border-amber-400/30 text-amber-300/90'
                : 'border-red-400/40 text-red-300';
            return (
              <span key={item.kind} className={`rounded border px-1.5 py-0.5 ${tone}`} title={item.reason}>
                {label} {item.status} · {item.count}
              </span>
            );
          })}
        </div>
      </div>
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-2">
          {shot.videoPath && (
            <input
              type="checkbox"
              checked={checked}
              onChange={onToggle}
              className="shrink-0 w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer"
            />
          )}
          <span className="font-mono text-[10px] text-[var(--canvas-text-3)]">{shot.shotNo}</span>
          <p className="flex-1 text-[11px] text-[var(--canvas-text-1)] truncate" title={shot.description}>{shot.description}</p>
          <select
            value={shot.videoModel ?? ''}
            onChange={(e) => {
              updateShot(shot.shotNo, { videoModel: e.target.value || undefined });
            }}
            className="shrink-0 px-1 py-0.5 rounded text-[10px] bg-[var(--canvas-panel)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] focus:outline-none focus-visible:border-[var(--canvas-accent)]"
            title={shot.videoModel ? `单独模型: ${shot.videoModel}` : `继承全局: ${data?.videoModel ?? 'Seedance 2.0'}`}
          >
            <option value="">{data?.videoModel === 'seedance-2.5' ? '全局(2.5)' : data?.videoModel === 'seedance-2.0-mini' ? '全局(Mini)' : isMiniMaxH3Model(data?.videoModel ?? '') ? '全局(H3)' : data?.videoModel === 'wan-3.0' ? '全局(万相3)' : '全局(2.0)'}</option>
            <option value="seedance-2.0">Seedance 2.0</option>
            <option value="seedance-2.5">Seedance 2.5</option>
            <option value="minimax-h3">MiniMax H3</option>
            <option value="seedance-2.0-mini">Mini</option>
            <option value="wan-3.0">万相 3.0</option>
          </select>
          <select
            value={shot.videoRatio ?? ''}
            onChange={(e) => updateShot(shot.shotNo, { videoRatio: e.target.value || undefined })}
            className="shrink-0 px-1 py-0.5 rounded text-[10px] bg-[var(--canvas-panel)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] focus:outline-none focus-visible:border-[var(--canvas-accent)]"
            title={shot.videoRatio ? `单独比例: ${shot.videoRatio}` : data?.videoRatio ? `继承全局: ${data.videoRatio}` : '未设置比例'}
          >
            <option value="">{data?.videoRatio ? `全局(${data.videoRatio})` : '比例'}</option>
            {VIDEO_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 p-1.5 rounded text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] transition-colors"
            title={expanded ? '收起' : '展开详情'}
          >
            <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {shot.genStatus === 'failed' && shot.genError && (
          <div className="mt-1">
            <div className="flex items-center gap-1.5">
              <p className="flex-1 min-w-0 truncate text-[10px] text-red-400" title={shot.genError}>{shot.genError}</p>
              <button
                onClick={() => void handleGenerateVideo()}
                disabled={!shot.videoRatio && !data?.videoRatio}
                className="shrink-0 px-1.5 py-0.5 rounded text-[10px] text-red-300 border border-red-500/50 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                title={(shot.videoRatio || data?.videoRatio) ? '重新生成视频' : '请先设置视频比例'}
              >
                重试
              </button>
              <button
                onClick={() => setErrorExpanded((v) => !v)}
                className="shrink-0 text-[10px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] transition-colors"
              >
                {errorExpanded ? '收起' : '查看详情'}
              </button>
            </div>
            {errorExpanded && (
              <p className="mt-1 text-[10px] leading-relaxed text-red-300/80 whitespace-pre-wrap break-all">{shot.genError}</p>
            )}
            {shot.videoPath && (
              <button
                onClick={() => updateShot(shot.shotNo, { genStatus: 'done', genError: undefined, genTaskId: undefined, genProgress: undefined })}
                className="text-[10px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)] mt-0.5 transition-colors"
              >
                视频文件已存在，恢复完成状态
              </button>
            )}
          </div>
        )}
      </div>
      {pendingVideoCandidates.length > 0 && (
        <div className="px-2.5 pb-2.5">
          <div className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
            <span className="shrink-0 text-[10px] text-amber-300">{candidateChoices.newer.length ? `新候选 ${candidateChoices.newer.length} 个` : `历史候选 ${candidateChoices.history.length} 个`}</span>
            <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--canvas-text-3)]">{candidateChoices.newer.length ? '新版本待评审；当前采用版本保持不变' : '当前版本已采用，历史候选仅供回看或手动切换'}</span>
            <button
              type="button"
              onClick={() => {
                const candidate = candidateChoices.latest;
                if (candidate) openCandidateReview(candidate);
                else setExpanded(true);
              }}
              disabled={!latestCandidateQualityPassed}
              className="shrink-0 rounded border border-amber-400/50 px-1.5 py-0.5 text-[10px] text-amber-200 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-35"
              title={candidateChoices.latest ? '评审最新生成的新版本，确认后替换当前采用版本' : '展开历史候选，不更改当前采用版本'}
            >
              {candidateChoices.latest ? '评审新版本' : '查看历史'}
            </button>
          </div>
        </div>
      )}
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-[var(--canvas-node-border)]">
          {(shot.boundaryFrameQualityReview || shot.videoQualityReview) && (
            <div className="pt-2 space-y-1.5">
              {shot.boundaryFrameQualityReview && (
                <div className={`rounded-md border px-2 py-1.5 ${boundaryQualityReviewStale ? 'border-amber-500/35 bg-amber-500/8' : shot.boundaryFrameQualityReview.passed ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className={boundaryQualityReviewStale ? 'text-amber-300' : shot.boundaryFrameQualityReview.passed ? 'text-emerald-300' : 'text-red-300'}>
                      首尾帧审核 · {boundaryQualityReviewStale ? '历史结果已失效' : `${shot.boundaryFrameQualityReview.score} 分`}
                    </span>
                    <span className="text-[var(--canvas-text-3)]">第 {shot.boundaryFrameQualityReview.attempt} 次</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--canvas-text-2)]">
                    {boundaryQualityReviewStale ? '首尾帧输入签名、审核服务地址或审核模型已经变化，请重新审核。' : shot.boundaryFrameQualityReview.summary}
                  </p>
                  {shot.boundaryFrameQualityReview.issues.length > 0 && <p className="mt-1 text-[10px] leading-relaxed text-[var(--canvas-text-3)]">{shot.boundaryFrameQualityReview.issues.map((issue) => issue.message).join('；')}</p>}
                </div>
              )}
              {shot.videoQualityReview && (
                <div className={`rounded-md border px-2 py-1.5 ${videoQualityReviewStale ? 'border-amber-500/35 bg-amber-500/8' : shot.videoQualityReview.passed ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                  <div className="text-[10px]">
                    <span className={videoQualityReviewStale ? 'text-amber-300' : shot.videoQualityReview.passed ? 'text-emerald-300' : 'text-red-300'}>
                      {shot.videoQualityReview.evidence?.method === 'sampled-frames' ? 'DSH 抽帧审核（非完整终审）' : '视频终审'} · {videoQualityReviewStale ? '历史结果已失效' : `${shot.videoQualityReview.score} 分`}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--canvas-text-2)]">
                    {videoQualityReviewStale ? '候选文件、候选指纹、审核服务地址或审核模型已经变化，请重新终审。' : shot.videoQualityReview.summary}
                  </p>
                  {shot.videoQualityReview.issues.length > 0 && <p className="mt-1 text-[10px] leading-relaxed text-[var(--canvas-text-3)]">{shot.videoQualityReview.issues.map((issue) => issue.message).join('；')}</p>}
                </div>
              )}
            </div>
          )}
          {shot.qualityReviewRequiresManualReview && h3Settings.task === 'fl2va' && (
            <div className="rounded-md border border-amber-500/35 bg-amber-500/8 px-2 py-1.5">
              <div className="text-[10px] font-medium text-amber-300">需要人工复盘</div>
              <p className="mt-1 text-[10px] leading-relaxed text-[var(--canvas-text-2)]">首尾帧已达到自动重绘上限。请检查本镜剧情、人物与道具状态、空间参照或绑定资产；修正后再重新生成首尾帧。</p>
            </div>
          )}
          {(isMiniMaxH3Model(model) ? ['i2va', 'fl2va'].includes(h3Settings.task) : Boolean(shot.videoStartFramePrompt || shot.videoEndFramePrompt)) && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {isMiniMaxH3Model(model) && (
                  <>
                    <button
                      type="button"
                      onClick={() => void refreshStartFramePrompt()}
                      className="inline-flex items-center gap-1 rounded border border-cyan-500/35 px-2 py-1 text-[10px] text-cyan-300 hover:bg-cyan-500/10"
                      title="按当前资产、上一镜尾帧和当前镜头 0.00 秒状态刷新首帧提示词；不会生成图片"
                    >
                      <RefreshCw size={10} /> 刷新首帧提示词
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStartFramePromptDraft(shot.plannedStartFramePrompt || shot.videoStartFramePrompt || '');
                        setEditingStartFramePrompt(true);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-[var(--canvas-node-border)] px-2 py-1 text-[10px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]"
                      title="编辑并保存首帧提示词"
                    >
                      编辑首帧提示词
                    </button>
                  </>
                )}
                {shot.videoStartFramePrompt && (
                  <button
                    type="button"
                    onClick={() => setPreviewText({
                      title: `${shot.shotNo} 首帧实际提示词`,
                      description: '最近一次真正提交给生图模型的完整首帧提示词，包含实际参考图编号、裁剪说明和当次审核修复补丁。',
                      content: shot.videoStartFramePrompt!,
                    })}
                    className="rounded border border-[var(--canvas-node-border)] px-2 py-1 text-[10px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]"
                  >
                    查看首帧提示词
                  </button>
                )}
                {shot.videoEndFramePrompt && (
                  <button
                    type="button"
                    onClick={() => setPreviewText({
                      title: `${shot.shotNo} 尾帧实际提示词`,
                      description: '最近一次真正提交给生图模型的完整尾帧提示词，包含实际参考图编号、完整动作因果和当次审核修复补丁。',
                      content: shot.videoEndFramePrompt!,
                    })}
                    className="rounded border border-[var(--canvas-node-border)] px-2 py-1 text-[10px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]"
                  >
                    查看尾帧提示词
                  </button>
                )}
              </div>
              {([
                { label: '首帧实际输入', paths: shot.videoStartFrameReferencePaths, labels: shot.videoStartFrameReferenceLabels },
                { label: '尾帧实际输入', paths: shot.videoEndFrameReferencePaths, labels: shot.videoEndFrameReferenceLabels },
              ] as const).map((group) => group.paths?.length ? (
                <div key={group.label} className="rounded-md border border-[var(--canvas-node-border)] px-2 py-1.5">
                  <div className="mb-1.5 text-[10px] text-[var(--canvas-text-3)]">{group.label} · {group.paths.length} 张</div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.paths.map((path, index) => (
                      <button
                        key={`${group.label}-${index}-${path}`}
                        type="button"
                        onClick={() => setPreviewImageUrl(boundaryReferenceUrl(path))}
                        className="group relative h-10 w-10 overflow-hidden rounded border border-[var(--canvas-node-border)] bg-black/30 focus:outline-none focus:ring-2 focus:ring-[var(--canvas-accent)]"
                        title={`图片${index + 1}：${group.labels?.[index] ?? path}`}
                      >
                        <img src={boundaryReferenceUrl(path)} className="h-full w-full object-cover" alt={group.labels?.[index] ?? `${group.label} 图片${index + 1}`} loading="lazy" decoding="async" />
                        <span className="absolute inset-x-0 bottom-0 bg-black/65 py-0.5 text-center text-[8px] text-white">{index + 1}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null)}
            </div>
          )}
          {shot.videoPath && !acceptedVideoCandidate && (
            <div className="pt-2">
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2 py-1.5">
                <span className="text-[10px] text-emerald-300">已采用视频</span>
                <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--canvas-text-2)]">正式视频</span>
                <button
                  type="button"
                  onClick={() => setPreviewCandidatePath(shot.videoPath!)}
                  className="shrink-0 rounded border border-[var(--canvas-node-border)] px-1.5 py-0.5 text-[10px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]"
                >
                  预览
                </button>
                <button
                  type="button"
                  onClick={() => void downloadAcceptedVideo()}
                  className="shrink-0 rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-500/10"
                >
                  <Download size={10} className="inline-block" /> 下载
                </button>
              </div>
            </div>
          )}
          {allVideoCandidates.length > 0 && (
            <div className="pt-2 space-y-1.5">
              <div className="text-[10px] text-[var(--canvas-text-3)]">全部版本</div>
              {allVideoCandidates.map((candidate, index) => {
                const isAdopted = candidate.path === shot.videoPath;
                const candidateQualityReview = videoQualityReviewForCandidate({
                  reports: [shot.videoQualityReview, ...(shot.qualityReviewHistory ?? [])],
                  candidatePath: candidate.path,
                  candidateFingerprint: videoCandidateFingerprint(candidate),
                  reviewerFingerprint,
                });
                const candidateQualityPassed = true;
                return <div key={candidate.path} className={`flex items-center gap-2 rounded-md border border-[var(--canvas-node-border)] px-2 py-1.5 ${isAdopted ? 'bg-white/[0.03] opacity-55 grayscale' : ''}`}>
                  <span className="text-[10px] text-[var(--canvas-text-3)]">版本 {index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--canvas-text-2)]" title={candidate.engineId ?? '视频生成'}>{candidate.engineId ?? '视频生成'}</span>
                  {h3Settings.qualityReviewEnabled && (
                    <span
                      className={`shrink-0 text-[10px] ${candidateQualityReview?.passed ? 'text-emerald-300' : candidateQualityReview ? 'text-red-300' : 'text-amber-300'}`}
                      title={candidateQualityReview?.summary ?? '该候选尚无与当前候选指纹匹配的终审'}
                    >
                      {candidateQualityReview ? `${candidateQualityReview.evidence?.method === 'sampled-frames' ? '抽帧审核' : candidateQualityReview.passed ? '终审通过' : '终审未过'} ${candidateQualityReview.score} 分` : '待终审'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void deleteVideoCandidate(candidate)}
                    disabled={isAdopted}
                    className="shrink-0 rounded border border-red-500/45 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/10"
                    title={isAdopted ? '当前采用版本不能删除，请先切换采用版本' : '删除候选及其本地视频文件'}
                  >
                    <Trash2 size={10} className="inline-block" /> 删除
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewCandidatePath(candidate.path)}
                    className="shrink-0 rounded border border-[var(--canvas-node-border)] px-1.5 py-0.5 text-[10px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]"
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadVideoCandidate(candidate.path, `候选${index + 1}`)}
                    className="shrink-0 rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-500/10"
                    title="下载这个候选视频"
                  >
                    <Download size={10} className="inline-block" /> 下载
                  </button>
                  <button
                    type="button"
                    onClick={() => openCandidateReview(candidate)}
                    disabled={isAdopted || !candidateQualityPassed}
                    className="shrink-0 rounded border border-emerald-500/50 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-35"
                    title={isAdopted ? '当前已采用此版本' : candidateQualityPassed ? '评审并采用这个候选' : '该候选尚未通过与其文件绑定的多模态终审'}
                  >
                    {isAdopted ? '已采用' : '采用'}
                  </button>
                </div>;
              })}
            </div>
          )}
          {isMiniMaxH3Model(model) && h3Settings.task === 'ref2va' && previousShot?.videoPath && canInheritAcceptedVideoTail(shot, previousShot) && (
            <div className="rounded-md border border-cyan-500/25 p-2 text-[10px] text-cyan-300">
              <div className="flex items-start justify-between gap-2">
                <div>
                  {shot.usePreviousTailAsFirstFrame
                    ? `上一镜 ${previousShot.shotNo} 成片尾帧 · 已指定为本镜 0.00 秒首帧`
                    : `上一镜 ${previousShot.shotNo} 成片尾帧 · 可选连续性参考`}
                  <p className="mt-0.5 text-[var(--canvas-text-3)]">
                    {shot.usePreviousTailAsFirstFrame
                      ? '本镜提示词将从该画面开场，随后继续动作；不锁定本镜结尾。'
                      : '默认不强制本镜首帧或尾帧，只用于身份、站位、朝向、道具和光线连续性。'}
                  </p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-cyan-200" title="开启后，本镜 0.00 秒将从这张上一镜尾帧开始">
                  <input
                    type="checkbox"
                    checked={Boolean(shot.usePreviousTailAsFirstFrame)}
                    onChange={(event) => {
                      updateShot(shot.shotNo, { usePreviousTailAsFirstFrame: event.target.checked || undefined });
                      void commitNow();
                    }}
                    className="h-3 w-3 accent-cyan-400"
                  />
                  指定为首帧
                </label>
              </div>
              {acceptedVideoTailPath(previousShot) ? (
                <button type="button" onClick={() => setPreviewImageUrl(convertFileSrc(acceptedVideoTailPath(previousShot)!))}>
                  <img src={convertFileSrc(acceptedVideoTailPath(previousShot)!)} alt="上一镜已采用视频真实尾帧" className="mt-2 h-20 rounded object-contain" />
                </button>
              ) : <p>尾帧截图尚未就绪；截图失败时重新采用上一镜视频即可重试，无需生图。</p>}
            </div>
          )}
          {isMiniMaxH3Model(model) && ['i2va', 'fl2va'].includes(h3Settings.task) && firstFrameInputs && (
            <div className="space-y-2 rounded-lg border border-[var(--canvas-node-border)] p-2">
              <div className="text-[11px] text-[var(--canvas-text-2)]">首帧制作素材 · 不直接提交给 H3 视频</div>
              <div className="flex flex-wrap gap-2">
                {firstFrameInputs.assets.map((ref) => (
                  <button key={`${ref.kind}:${ref.id}:${ref.path}`} type="button"
                    onClick={() => setPreviewImageUrl(convertFileSrc(ref.path))}
                    className="flex max-w-[100px] flex-col items-center gap-1 text-[10px] text-[var(--canvas-text-2)]"
                    title={`首帧参考：${ref.label}`}>
                    <img src={convertFileSrc(ref.path)} alt={ref.label} className="h-12 w-12 rounded object-cover" loading="lazy" />
                    <span className="max-w-full truncate">{ref.label}</span>
                  </button>
                ))}
                {firstFrameInputs.assets.length === 0 && (
                  <span className="text-[10px] text-amber-300/80">本镜暂无可用资产图片，请检查场景、角色、道具绑定与图片生成状态。</span>
                )}
              </div>
              <div className="flex items-center gap-2 border-t border-[var(--canvas-node-border)] pt-2">
                {firstFrameInputs.previousTail && (
                  <button type="button" onClick={() => setPreviewImageUrl(convertFileSrc(firstFrameInputs.previousTail!))}
                    title="放大查看上一镜尾帧" className="shrink-0">
                    <img src={convertFileSrc(firstFrameInputs.previousTail)} alt="上一镜尾帧（连续性参考）"
                      className="h-12 w-16 rounded object-cover" loading="lazy" />
                  </button>
                )}
                <span className="text-[10px] text-[var(--canvas-text-2)]">{firstFrameInputs.continuityMessage}</span>
              </div>
              <p className="text-[10px] text-[var(--canvas-text-3)]">先用上述素材与连续性参考制作本镜首帧；视频阶段仅提交当前模式要求的首帧／尾帧，不会把这些资产全部传给视频模型。</p>
            </div>
          )}
          <div className="flex items-center gap-1.5 pt-2 flex-wrap">
            <span className="text-[10px] text-[var(--canvas-text-3)]">{isMiniMaxH3Model(model) ? '视频实际输入' : '资产'}</span>
            {isMiniMaxH3Model(model) && refImages.length === 0 && (
              <span className="text-[10px] text-amber-300/80">
                {h3Settings.task === 't2va' ? '纯文本模式不提交素材' : '暂无视频输入；首帧素材与连续性参考见上方'}
              </span>
            )}
            {isMiniMaxH3Model(model) && (
              <button
                type="button"
                onClick={handlePreviewH3Payload}
                className="ml-auto rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-500/10"
                title="查看提交给 MiniMax-H3 的完整请求快照"
              >
                查看 H3 提交参数
              </button>
            )}
            {refImages.map((ref, i) => (
              <div key={i} className="shrink-0 flex flex-col items-center gap-0.5 relative group/ref">
                {ref.type === 'audio' ? (
                  <div className="w-8 h-8 rounded border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-[10px] text-[var(--canvas-text-2)]">音</div>
                ) : ref.type === 'video' ? (
                  <div className="w-8 h-8 rounded border border-[var(--canvas-node-border)] bg-black/50 flex items-center justify-center text-[10px] text-[var(--canvas-text-2)]">视</div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPreviewImageUrl(ref.url)}
                    className="relative w-8 h-8 rounded overflow-hidden border border-[var(--canvas-node-border)] cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-[var(--canvas-accent)]"
                    title={`放大查看 ${ref.label}`}
                    aria-label={`放大查看 ${ref.label}`}
                  >
                    <img src={ref.url} className="w-full h-full object-cover" alt={ref.label} loading="lazy" decoding="async" />
                    <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-white group-hover/ref:flex">
                      <Maximize2 size={12} />
                    </span>
                  </button>
                )}
                <span className="text-[10px] text-[var(--canvas-accent)]">{ref.label}</span>
                {ref.removable && (
                  <button
                    onClick={() => removeRef(ref)}
                    className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center opacity-0 group-hover/ref:opacity-100 transition-opacity"
                    title="移除"
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-red-500/80 flex items-center justify-center">
                      <X size={8} className="text-white" />
                    </span>
                  </button>
                )}
              </div>
            ))}
            <div className="relative shrink-0">
              <button
                type="button" aria-label="添加参考图" aria-haspopup="menu" aria-expanded={addMenuOpen}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setAddMenuPosition({
                    left: Math.max(12, Math.min(rect.left, window.innerWidth - 212)),
                    top: rect.bottom + 110 > window.innerHeight ? Math.max(12, rect.top - 104) : rect.bottom + 4,
                  });
                  setAddMenuOpen(!addMenuOpen);
                }}
                className="w-8 h-8 rounded border border-dashed border-[var(--canvas-node-border)] flex items-center justify-center text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] hover:border-[var(--canvas-text-2)] transition-colors"
                title="添加参考图"
              >
                <Plus size={12} />
              </button>
              {addMenuOpen && createPortal(
                <div className="canvas-dark fixed inset-0" style={{ zIndex: Z.popover }} onClick={() => setAddMenuOpen(false)}>
                  <div
                    role="menu" aria-label="添加参考图来源"
                    className="absolute w-[200px] max-w-[calc(100vw-24px)] rounded-lg border border-[var(--canvas-node-border)] py-1 shadow-lg"
                    style={{ ...addMenuPosition, background: 'var(--canvas-panel)' }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button" role="menuitem"
                      onClick={() => void handleUploadRef()}
                      className="w-full px-3 py-1.5 text-left text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                    >
                      <Upload size={10} /> 上传本地图
                    </button>
                    <button
                      type="button" role="menuitem"
                      onClick={() => { setProjectAssetPickerOpen(true); setAddMenuOpen(false); }}
                      className="w-full px-3 py-1.5 text-left text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                    >
                      <FolderOpen size={10} className="shrink-0" /> 从当前项目资产添加
                    </button>
                    <button
                      type="button" role="menuitem"
                      onClick={() => { setPickerOpen(true); setAddMenuOpen(false); }}
                      className="w-full px-3 py-1.5 text-left text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                    >
                      <ImageIcon size={10} /> 从素材库选
                    </button>
                  </div>
                </div>, document.body,
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--canvas-node-border)] bg-black/10 px-2.5 py-2">
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSingleShotRewrite()}
                disabled={singleShotRewriting}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-cyan-500/45 bg-cyan-500/8 px-2.5 text-[10px] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                title="直接调用文本模型，按当前模型、模板、资产和最新规则重写这一镜"
              >
                {singleShotRewriting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {singleShotRewriting ? '正在重写' : 'AI 重写本镜'}
              </button>

            </div>
          </div>
          <SmartTextarea
            value={displayedVideoPrompt}
            onChange={(v) => updateShot(shot.shotNo,
              promptTemplate === 'universal'
                ? isSeedance25 ? { seedance25VideoPrompt: v } : { universalVideoPrompt: v }
                : { videoPrompt: v })}
            placeholder="输入新版视频提示词"
            mentionHighlight
            referenceImages={refImages}
            rows={2}
          />
          {(shot.generatedAudios?.length ?? 0) > 0 && (
            <ShotAudioRow audios={shot.generatedAudios!} limitSec={isSeedance25 ? 30 : 15} />
          )}
        </div>
      )}
      {pickerOpen && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)', zIndex: Z.picker }} onClick={() => setPickerOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <ArtifactPickerPanel
              open
              onClose={() => setPickerOpen(false)}
              onPick={(entry) => void handlePickArtifact(entry)}
              inline
            />
          </div>
        </div>
      )}
      {projectAssetPickerOpen && data && (
        <ProjectAssetPicker
          key={`${data.projectId}:${shotStableSelectionId(shot)}`}
          images={projectAssetImages(data)}
          existingPaths={buildImageRefBindings(shot, { ...data, props: data.props ?? [] }).map((ref) => ref.path)}
          onAdd={handlePickProjectAssets}
          onClose={() => setProjectAssetPickerOpen(false)}
        />
      )}
      {previewImageUrl && (
        <ImageFullscreenViewer imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      )}
      {previewCandidatePath && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-6" style={{ zIndex: Z.modal }} onClick={() => setPreviewCandidatePath(null)}>
          <div className="max-h-full max-w-4xl rounded-xl border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] p-3" onClick={(event) => event.stopPropagation()}>
            <video src={convertFileSrc(previewCandidatePath)} controls autoPlay className="max-h-[75vh] max-w-full rounded-lg bg-black" />
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={() => setPreviewCandidatePath(null)} className="rounded-md border border-[var(--canvas-node-border)] px-2 py-1 text-[11px] text-[var(--canvas-text-2)]">关闭</button>
            </div>
          </div>
        </div>
      )}
      {previewText && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-6" style={{ zIndex: Z.modal }} onClick={() => setPreviewText(null)}>
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-cyan-500/30 bg-[var(--canvas-panel)] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[13px] font-medium text-[var(--canvas-text-1)]">{previewText.title}</h3>
                <p className="mt-0.5 text-[10px] text-[var(--canvas-text-3)]">{previewText.description}</p>
              </div>
              <button type="button" onClick={() => setPreviewText(null)} className="rounded p-1 text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]" aria-label="关闭完整文本预览">
                <X size={14} />
              </button>
            </div>
            <pre className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--canvas-node-border)] bg-black/20 p-3 text-[11px] leading-5 text-[var(--canvas-text-2)]">{previewText.content}</pre>
          </div>
        </div>
      )}
      {editingStartFramePrompt && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-6" style={{ zIndex: Z.modal }} onClick={() => setEditingStartFramePrompt(false)}>
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-cyan-500/30 bg-[var(--canvas-panel)] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)]">编辑首帧生图提示词</h3>
                <p className="mt-0.5 text-[10px] text-[var(--canvas-text-3)]">只影响后续首帧生成，不会自动生成图片或视频。</p>
              </div>
              <button type="button" onClick={() => setEditingStartFramePrompt(false)} className="rounded p-1 text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]" aria-label="关闭首帧提示词编辑"><X size={14} /></button>
            </div>
            <textarea
              value={startFramePromptDraft}
              onChange={(event) => setStartFramePromptDraft(event.target.value)}
              className="mt-3 min-h-[360px] flex-1 resize-y rounded-lg border border-[var(--canvas-node-border)] bg-black/20 p-3 text-[11px] leading-5 text-[var(--canvas-text-2)] outline-none focus:border-cyan-500/60"
              spellCheck={false}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setEditingStartFramePrompt(false)} className="rounded border border-[var(--canvas-node-border)] px-3 py-1.5 text-[11px] text-[var(--canvas-text-2)]">取消</button>
              <button type="button" onClick={() => void saveStartFramePromptDraft()} className="rounded bg-cyan-500/80 px-3 py-1.5 text-[11px] text-white hover:bg-cyan-500">保存提示词</button>
            </div>
          </div>
        </div>
      )}
      {reviewCandidate && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-6" style={{ zIndex: Z.modal }} onClick={() => { if (!reviewSavingRef.current) setReviewCandidate(null); }}>
          <div className="w-full max-w-lg rounded-xl border border-emerald-500/30 bg-[var(--canvas-panel)] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)]">评审并采用视频候选</h3>
                <p className="mt-0.5 truncate text-[10px] text-[var(--canvas-text-3)]">{reviewCandidate.candidate.engineId ?? '视频生成'} · {reviewCandidate.candidate.path}</p>
              </div>
              <button type="button" onClick={() => { if (!reviewSavingRef.current) setReviewCandidate(null); }} className="rounded p-1 text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]" aria-label="关闭评审"><X size={14} /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {([
                ['continuity', '跨镜连续性'],
                ['visualIdentity', '视觉身份'],
                ['performance', '表演动作'],
                ['pacing', '节奏时长'],
              ] as const).map(([key, label]) => (
                <label key={key} className="text-[10px] text-[var(--canvas-text-3)]">
                  {label}
                  <select
                    value={reviewCandidate.criteria[key] ?? 'not-reviewed'}
                    onChange={(event) => setReviewCandidate((current) => current ? { ...current, criteria: { ...current.criteria, [key]: event.target.value as VideoReviewCriteria[typeof key] } } : current)}
                    className="mt-1 w-full rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2 py-1.5 text-[11px] text-[var(--canvas-text-1)]"
                  >
                    <option value="pass">通过</option>
                    <option value="fail">不通过</option>
                    <option value="not-reviewed">未评审</option>
                  </select>
                </label>
              ))}
            </div>
            <textarea
              value={reviewCandidate.note}
              onChange={(event) => setReviewCandidate((current) => current ? { ...current, note: event.target.value } : current)}
              rows={3}
              placeholder="补充评审意见（可选）：例如人物身份稳定、上一镜尾帧衔接自然……"
              className="mt-3 w-full resize-y rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-2.5 py-2 text-[11px] leading-5 text-[var(--canvas-text-1)] outline-none placeholder:text-[var(--canvas-text-3)]"
            />
            {reviewError && <p role="alert" className="mt-3 text-[11px] text-red-300 whitespace-pre-wrap">{reviewError}</p>}
            <p className="mt-2 text-[10px] text-[var(--canvas-text-3)]">“未评审”会如实保存，不代表质量通过；采用此候选将替换当前版本。</p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => { if (!reviewSavingRef.current) setReviewCandidate(null); }} className="rounded-lg border border-[var(--canvas-node-border)] px-3 py-1.5 text-[11px] text-[var(--canvas-text-2)]">取消</button>
              <button type="button" disabled={reviewSaving} onClick={() => void acceptReviewedCandidate()} className="rounded-lg bg-emerald-500/80 px-3 py-1.5 text-[11px] text-white hover:bg-emerald-500">{reviewSaving ? '正在保存评审…' : '确认采用并保存评审'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
