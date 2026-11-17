import { prepareEditorImport } from '@/lib/workshop/editorImport';
/**
 * StepHandoff — ⑥交付：把成片导入画布（建节点网格）或剪辑时间轴。
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, BookOpen, CheckCircle2, Clapperboard, Download, Eye, LayoutDashboard, Loader2, RotateCcw, Scissors, ShieldAlert, Trash2, X } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { readBinaryFile, writeBinaryFile, writeTextFile, createDir } from '@tauri-apps/api/fs';
import { desktopDir } from '@tauri-apps/api/path';
import { exportPreviewBundle } from '@/lib/workshop/previewBundle';
import { confirm as tauriConfirm, message as tauriMessage } from '@tauri-apps/api/dialog';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { useRenderQueueStore } from '@/stores/renderQueueStore';
import { useChatStore } from '@/stores';
import { useSettingsStore } from '@/stores/settingsStore';
import { syncWorkshopLineageToCanvas } from '@/lib/workshop/canvasSync';
import { reconcileHandoffNodes, placeNewHandoffNodes } from '@/lib/workshop/handoffCanvas';
import { deliveryReviewStatus } from '@/lib/workshop/deliveryReviewStatus';
import { readProjectFile, writeProject, writeProjectFile, type AigcProject } from '@/lib/aigc/projectStore';
import { exportProject } from '@/lib/projectArchive';
import { buildDeliveryManifest } from '@/lib/workshop/deliveryManifest';
import { buildProductionAudit } from '@/lib/workshop/productionAudit';
import { validateVideoArtifact } from '@/lib/workshop/mediaValidation';
import { bindingIsCurrent, productionCandidateFingerprint } from '@/lib/production/lifecycle';

import type { ProductionCandidate } from '@/lib/production/lifecycle';
import { qualityReviewerFingerprint } from '@/lib/workshop/qualityReview';
import { summarizeWorkshopQuality } from '@/lib/workshop/qualityStats';

const fmtImportDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

type CanvasImportBatch = { nodeIds: string[]; at: number; count: number };

// 旧形态 canvas 记录是单批 { nodeIds, at, count }（无 main 字段），读取时归一为 { main, copies: [] }
const normalizeCanvasImport = (
  raw: NonNullable<AigcProject['handoffImports']>['canvas'] | undefined,
): { main: CanvasImportBatch; copies: CanvasImportBatch[] } | undefined => {
  if (!raw) return undefined;
  const legacy = raw as unknown as Partial<CanvasImportBatch>;
  const main =
    raw.main ??
    (Array.isArray(legacy.nodeIds) && typeof legacy.at === 'number' && typeof legacy.count === 'number'
      ? { nodeIds: legacy.nodeIds, at: legacy.at, count: legacy.count }
      : undefined);
  if (!main) return undefined;
  return { main, copies: Array.isArray(raw.copies) ? raw.copies : [] };
};

export default function StepHandoff() {
  const data = useWorkshopStore((s) => s.data);
  const shots = data?.shots;
  const project = useWorkshopStore((s) => s.project);
  const markStepStatus = useWorkshopStore((s) => s.markStepStatus);
  const logChange = useWorkshopStore((s) => s.logChange);
  const setCurrentStep = useWorkshopStore((s) => s.setCurrentStep);
  const removeQualityLearningRule = useWorkshopStore((s) => s.removeQualityLearningRule);
  const removeQualityPromptExample = useWorkshopStore((s) => s.removeQualityPromptExample);
  const resetQualityLearning = useWorkshopStore((s) => s.resetQualityLearning);
  const restoreAdoptedVideoCandidates = useWorkshopStore((s) => s.restoreAdoptedVideoCandidatesFromCanvas);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const qualityReviewSettings = useSettingsStore((settings) => ({
    enabled: settings.qualityReviewEnabled,
    baseUrl: settings.qualityReviewBaseUrl,
    model: settings.qualityReviewModel,
  }));
  const [busy, setBusy] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [renderAcceptBusy, setRenderAcceptBusy] = useState(false);
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [qualityPromptId, setQualityPromptId] = useState<string | null>(null);

  useEffect(() => {
    void restoreAdoptedVideoCandidates();
  }, [data?.projectId, data?.canvasProjectId, restoreAdoptedVideoCandidates]);

  if (!shots) return null;
  const shotsWithMedia = shots.filter((s) => s.imagePath || s.videoPath);
  const shotsWithVideo = shots.filter((s) => s.videoPath);
  const canvasImport = normalizeCanvasImport(project?.handoffImports?.canvas);
  // 状态行/确认文案展示全部批次的合计数量与最近导入时间
  const canvasImportCount = canvasImport
    ? canvasImport.main.count + canvasImport.copies.reduce((sum, c) => sum + c.count, 0)
    : 0;
  const canvasImportAt = canvasImport
    ? Math.max(canvasImport.main.at, ...canvasImport.copies.map((c) => c.at))
    : 0;
  const editorImport = project?.handoffImports?.editor;
  const reviewerFingerprint = qualityReviewSettings.enabled
    ? qualityReviewerFingerprint(qualityReviewSettings.baseUrl, qualityReviewSettings.model)
    : undefined;
  const audit = data ? buildProductionAudit(data, {
    reviewerFingerprint, videoQualityReviewRequired: qualityReviewSettings.enabled,
  }) : undefined;
  const renderCandidates = data?.renderCandidates ?? [];
  const qualityLearning = data?.qualityLearning;
  const qualityStats = summarizeWorkshopQuality(shots);
  const selectedQualityPrompt = qualityLearning?.highScorePrompts.find((example) => example.id === qualityPromptId);
  const hasQualityLearning = Boolean(qualityLearning?.avoidanceRules.length || qualityLearning?.highScorePrompts.length);
  const hasQualityEvidence = hasQualityLearning || qualityStats.reviewCount > 0;
  const renderCandidateIsAccepted = (candidate: ProductionCandidate) => bindingIsCurrent({
    candidate,
    binding: data?.renderProductionBinding,
    reviews: data?.renderReviews,
  });

  const handleResetQualityLearning = async () => {
    const ok = await tauriConfirm(
      '将删除本项目积累的全部质量规避规则和高分提示词样例。不会删除剧本、素材、首尾帧或视频候选，是否继续？',
      { title: '重置质量学习', type: 'warning' },
    ).catch(() => false);
    if (!ok) return;
    setQualityPromptId(null);
    resetQualityLearning();
  };

  const persistDeliveryManifest = async () => {
    if (!project) return;
    const currentData = useWorkshopStore.getState().data;
    const currentShots = currentData?.shots ?? shots;
    const currentShotsWithVideo = currentShots.filter((shot) => shot.videoPath);
    const checksums: Record<string, string> = {};
    const videoValidations: Record<string, { valid: boolean; reason?: string }> = {};
    for (const shot of currentShotsWithVideo) {
      const bytes = await readBinaryFile(shot.videoPath!);
      videoValidations[shot.videoPath!] = validateVideoArtifact(bytes);
      const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
      checksums[shot.videoPath!] = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
      if (shot.audioInjected) {
        for (const audio of shot.generatedAudios ?? []) {
          const path = audio.trimmedPath || audio.path;
          const audioBytes = await readBinaryFile(path);
          const audioDigest = await crypto.subtle.digest('SHA-256', audioBytes.slice().buffer);
          checksums[path] = [...new Uint8Array(audioDigest)].map((value) => value.toString(16).padStart(2, '0')).join('');
        }
      }
    }
    const renderCandidates = useWorkshopStore.getState().data?.renderCandidates ?? [];
    const renderCandidate = renderCandidates[renderCandidates.length - 1];
    let renderVideoValidation: { valid: boolean; reason?: string } | undefined;
    if (renderCandidate) {
      try {
        const bytes = await readBinaryFile(renderCandidate.path);
        renderVideoValidation = validateVideoArtifact(bytes);
        const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
        checksums[renderCandidate.path] = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
      } catch {
        // Manifest remains blocked when the render file is unavailable.
      }
    }
    const manifest = buildDeliveryManifest({
      projectId: project.id,
      shots: currentShots,
      checksums,
      currentScriptRevisionId: currentData?.currentScriptRevisionId,
      renderCandidate,
      renderReviews: currentData?.renderReviews,
      renderBinding: currentData?.renderProductionBinding,
      productionRuns: currentData?.productionRuns,
      videoValidations,
      renderVideoValidation,
      reviewerFingerprint,
      videoQualityReviewRequired: qualityReviewSettings.enabled,
    });
    const serialized = JSON.stringify(manifest, null, 2);
    await writeProjectFile(project.id, 'delivery/delivery-manifest.json', serialized);
    const persisted = await readProjectFile(project.id, 'delivery/delivery-manifest.json');
    const persistedManifest = persisted ? JSON.parse(persisted) as { projectId?: string; generatedAt?: number } : undefined;
    if (!persistedManifest || persistedManifest.projectId !== manifest.projectId || persistedManifest.generatedAt !== manifest.generatedAt) {
      throw new Error('delivery manifest 写盘校验失败');
    }
    return manifest;
  };

  const persistHandoffImports = async (handoffImports: NonNullable<AigcProject['handoffImports']>) => {
    if (!project) return;
    const next = { ...project, handoffImports, updatedAt: Date.now() };
    await writeProject(next);
    useWorkshopStore.setState({ project: next });
  };

  const handleExportDelivery = async () => {
    if (deliveryBusy || !project) return;
    setDeliveryError(null);
    setDeliveryBusy(true);
    try {
      const manifest = await persistDeliveryManifest();
      if (!manifest) throw new Error('项目未加载，无法生成交付 manifest');
      if (manifest.status === 'blocked') {
        setDeliveryError(`交付门禁未通过：${manifest.reason}`);
        return;
      }
      const currentData = useWorkshopStore.getState().data;
      const zipPath = await exportProject(project.id, currentData?.canvasProjectId);
      markStepStatus('handoff', 'done');
      logChange('handoff', '导出已通过校验的交付包');
      await tauriMessage(`交付包已导出到桌面：\n${zipPath}\n\n包内包含正式视频、delivery-manifest.json 以及项目生产世系。`, { title: '交付包导出成功' });
    } catch (err) {
      setDeliveryError(`导出交付包失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeliveryBusy(false);
    }
  };

  const handleExportPreview = async () => {
    if (deliveryBusy || !project) return;
    setDeliveryBusy(true);
    setDeliveryError(null);
    try {
      const snapshot = useWorkshopStore.getState().data;
      if (snapshot?.projectId !== project.id) throw new Error('项目已切换');
      const dir = `${await desktopDir()}GDream-internal-preview-${project.id}-${Date.now()}`;
      await exportPreviewBundle({ projectId:project.id, shots:snapshot.shots, directory:dir, reviewerFingerprint, io:{
        mkdir:async path => { await createDir(path, {recursive:true}); },
        read:readBinaryFile,
        validate:bytes => validateVideoArtifact(bytes).valid,
        digest:async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice().buffer))].map(b=>b.toString(16).padStart(2,'0')).join(''),
        writeBytes:async (path,bytes) => { await writeBinaryFile(path,bytes); },
        writeText:async (path,text) => { await writeTextFile(path,text); },
      }});
      await tauriMessage(`内部预览素材包已保存：\n${dir}\n\n这不是最终成片或正式交付；未修改审核状态，未启动任何生成。`,{title:'内部预览素材包'});
    } catch (err) {
      setDeliveryError(`预览包未完成：${err instanceof Error ? err.message : String(err)}`);
    } finally { setDeliveryBusy(false); }
  };

  const handleAcceptRender = (candidate: ProductionCandidate) => {
    if (renderAcceptBusy || renderCandidateIsAccepted(candidate)) return;
    setRenderAcceptBusy(true);
    setDeliveryError(null);
    try {
      const fingerprint = productionCandidateFingerprint(candidate);
      const renderJobId = typeof candidate.metadata?.jobId === 'string'
        ? candidate.metadata.jobId
        : undefined;
      useWorkshopStore.getState().acceptRenderCandidate(
        candidate.candidateId,
        fingerprint,
        'local-user',
        '在交付页确认最终渲染候选',
      );
      if (renderJobId) {
        const queueJob = useRenderQueueStore.getState().jobs.find((job) => job.id === renderJobId);
        if (queueJob?.candidate && productionCandidateFingerprint(queueJob.candidate) === fingerprint) {
          useRenderQueueStore.getState().acceptCandidate(
            renderJobId,
            fingerprint,
            'local-user',
            '在交付页确认最终渲染候选',
          );
        }
      }
    } catch (err) {
      setDeliveryError(`接受渲染候选失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRenderAcceptBusy(false);
    }
  };

  const handleToCanvas = async () => {
    if (canvasBusy || !project || !data || shotsWithMedia.length === 0) return;
    const canvasProject = useProjectStore.getState();
    if (!data.canvasProjectId || canvasProject.activeProjectId !== data.canvasProjectId || canvasProject.switching) {
      setCanvasError('关联画布未加载，请先打开本项目画布后同步');
      return;
    }
    setCanvasBusy(true);
    setCanvasError(null);
    try {
      const currentCanvas = useCanvasStore.getState();
      const plan = reconcileHandoffNodes(currentCanvas.nodes, currentCanvas.edges, project.id);
      const duplicates = currentCanvas.nodes.length - plan.nodes.length;
      if (duplicates > 0) {
        const confirmed = await tauriConfirm(
          `检测到 ${duplicates} 个历史导入的重复节点。将合并到已有分镜节点，保留素材版本并转接连线；不会删除视频文件。其余已有节点保留位置，只补缺失项。继续？`,
          {title:'画布导入冲突检测',type:'warning'},
        );
        if (!confirmed) return;
      }
      if (useWorkshopStore.getState().data?.projectId !== project.id
        || useProjectStore.getState().activeProjectId !== data.canvasProjectId) throw new Error('项目已切换，停止导入');
      const originalIds = new Set(useCanvasStore.getState().nodes.map(n => n.id));
      // Use the same upsert path as live synchronization. No separate grid,
      // no destructive delete-and-recreate, and no implicit duplicate batches.
      const result = await syncWorkshopLineageToCanvas();
      if (useWorkshopStore.getState().data?.projectId !== project.id
        || useProjectStore.getState().activeProjectId !== data.canvasProjectId) throw new Error('项目已切换，停止导入');
      if (!result.startsWith('血缘图已同步')) throw new Error(result);
      const store = useCanvasStore.getState();
      const reconciled = reconcileHandoffNodes(store.nodes, store.edges, project.id);
      store.setNodes(placeNewHandoffNodes(reconciled.nodes, originalIds));
      store.setEdges(reconciled.edges);
      await useProjectStore.getState().flushActiveCanvas();
      const nodeIds = useCanvasStore.getState().nodes.filter(n => {
        const ref = n.data.workshopRef;
        return ref?.projectId === project.id && ref.kind === 'shot' && ['shot-video','shot-image'].includes(ref.role);
      }).map(n => n.id);
      await persistHandoffImports({ ...project.handoffImports, canvas: {
        main: {nodeIds, at:Date.now(), count:nodeIds.length}, copies:[],
      }});
      logChange('handoff', `同步画布 ${nodeIds.length} 个素材节点（复用已有、仅补缺失）`);
      setActiveView('canvas');
    } catch (err) {
      setCanvasError(`画布同步未完成，可安全重试：${err instanceof Error ? err.message : String(err)}`);
    } finally { setCanvasBusy(false); }
  };

  const handleToEditor = async () => {
    if (busy || !project) return;
    // Lock before the async confirmation to prevent duplicate click submissions.
    setBusy(true);
    setEditorError(null);
    try {
      if (editorImport) {
        const ok = await tauriConfirm(
          `上次已导入 ${editorImport.count} 段（${fmtImportDate(editorImport.at)}），再次导入将在时间轴追加重复片段，继续？`,
          { title: '导入剪辑', type: 'warning' },
        ).catch(() => false);
        if (!ok) return;
      }
      const current = useWorkshopStore.getState().data;
      if (current?.projectId !== project.id) throw new Error('项目已切换，停止导入');
      // Unreviewed media must be editable: audio, subtitles and visual repairs
      // happen here. Only the formal delivery export runs the delivery gate.
      const items = await prepareEditorImport(current.shots, readBinaryFile);
      if (useWorkshopStore.getState().data?.projectId !== project.id) throw new Error('项目已切换，停止导入');
      const clipIds = await useEditorStore.getState().addClips(items);
      logChange('handoff', `导入剪辑 ${items.length} 段（仅进入制作，不代表终审通过）`);
      await persistHandoffImports({
        ...project.handoffImports,
        editor: { clipIds, at: Date.now(), count: items.length },
      });
      setActiveView('editor');
    } catch (err) {
      setEditorError(`导入剪辑失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[720px] mx-auto px-8 py-8 pb-16">
      <h2 className="text-[16px] font-semibold text-[var(--canvas-text-1)]">⑥ 交付</h2>
      <p className="text-[12px] text-[var(--canvas-text-3)] mt-1 mb-8">
        成片片段 {shotsWithVideo.length} 段 · 分镜素材共 {shotsWithMedia.length} 个
      </p>

      {audit && (
        <section className="mb-6 rounded-xl border border-[var(--canvas-node-border)] p-4" style={{ background: 'var(--canvas-node-bg)' }}>
          <div className="flex items-center gap-2">
            {audit.status === 'pass' ? <CheckCircle2 size={16} className="text-emerald-400" /> : audit.status === 'blocked' ? <ShieldAlert size={16} className="text-red-400" /> : <AlertTriangle size={16} className="text-amber-400" />}
            <div>
              <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)]">生产审计 · {audit.status === 'pass' ? '可交付' : audit.status === 'blocked' ? '存在阻断项' : '仍有待处理项'}</h3>
              <p className="text-[10px] text-[var(--canvas-text-3)] mt-0.5">集中查看原子镜头、资产引用、候选评审绑定和渲染世系</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-1.5 lg:grid-cols-2">
            {audit.checks.map((item) => (
              <div key={item.id} className="flex min-w-0 items-start gap-1.5 rounded-md px-2 py-1.5 text-[10px]" style={{ background: 'rgba(255,255,255,0.035)' }}>
                <span className={`shrink-0 ${item.status === 'pass' ? 'text-emerald-400' : item.status === 'blocked' ? 'text-red-400' : 'text-amber-400'}`}>{item.status === 'pass' ? '✓' : item.status === 'blocked' ? '!' : '·'}</span>
                <div className="min-w-0">
                  <div className="break-words text-[var(--canvas-text-2)]">{item.label}</div>
                  <div className="mt-0.5 break-words text-[var(--canvas-text-3)]">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--canvas-text-3)]">
            <span>剧本：{audit.lineage.scriptRevisionId ?? '未冻结'}</span>
            <span>渲染候选：{audit.lineage.renderCandidateId ?? '暂无'}</span>
            <span>绑定：{audit.lineage.renderBindingId ?? '未采用'}</span>
            {data.changelog.length > 0 && <span>最近变更：{new Date(data.changelog[data.changelog.length - 1].at).toLocaleString()}</span>}
          </div>
        </section>
      )}

      <section className="mb-6 rounded-xl border border-[var(--canvas-node-border)] p-4" style={{ background: 'var(--canvas-node-bg)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <BookOpen size={16} className="mt-0.5 text-[var(--canvas-accent)]" />
            <div>
              <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)]">质量学习</h3>
              <p className="mt-0.5 text-[10px] text-[var(--canvas-text-3)]">
                仅管理本项目审核沉淀的规避规则与高分提示词，不会触发生成或修改剧情。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleResetQualityLearning()}
            disabled={!hasQualityLearning}
            className="shrink-0 rounded-md border border-[var(--canvas-node-border)] px-2 py-1.5 text-[10px] text-[var(--canvas-text-2)] hover:border-red-400/60 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <RotateCcw size={11} className="mr-1 inline" />全部重置
          </button>
        </div>

        {qualityStats.reviewCount > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
            {[
              ['审核回执', `${qualityStats.reviewCount}`],
              ['通过率', `${qualityStats.passRate}%`],
              ['平均分', `${qualityStats.averageScore}`],
              ['首尾帧 / 视频', `${qualityStats.boundaryFrameReviewCount} / ${qualityStats.videoReviewCount}`],
              ['人工复盘镜头', `${qualityStats.manualReviewShotCount}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-[var(--canvas-node-border)] px-2.5 py-2">
                <div className="text-[9px] text-[var(--canvas-text-3)]">{label}</div>
                <div className="mt-1 text-[14px] font-medium text-[var(--canvas-text-1)]">{value}</div>
              </div>
            ))}
            {qualityStats.topIssue && (
              <div className="col-span-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 text-[10px] text-amber-200 md:col-span-5">
                高频问题：{qualityStats.topIssue.code} · {qualityStats.topIssue.count} 次
              </div>
            )}
          </div>
        )}

        {!hasQualityEvidence ? (
          <div className="mt-3 rounded-lg border border-dashed border-[var(--canvas-node-border)] px-3 py-4 text-center text-[10px] text-[var(--canvas-text-3)]">
            暂无质量学习记录。通过首尾帧或视频审核后，项目会在这里沉淀可复用规则。
          </div>
        ) : hasQualityLearning ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between text-[10px]">
                <span className="font-medium text-[var(--canvas-text-2)]">问题规避规则</span>
                <span className="text-[var(--canvas-text-3)]">{qualityLearning?.avoidanceRules.length ?? 0} 条</span>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {qualityLearning?.avoidanceRules.map((rule) => (
                  <article key={rule.code} className="rounded-lg border border-[var(--canvas-node-border)] p-2.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-[var(--canvas-text-3)]">
                          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">{rule.code}</span>
                          <span>出现 {rule.occurrences} 次</span>
                          <span>{new Date(rule.lastSeenAt).toLocaleString()}</span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[var(--canvas-text-2)]">{rule.rule}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeQualityLearningRule(rule.code)}
                        className="shrink-0 rounded p-1 text-[var(--canvas-text-3)] hover:bg-red-500/10 hover:text-red-300"
                        title="删除这条规避规则"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-[10px]">
                <span className="font-medium text-[var(--canvas-text-2)]">高分提示词样例</span>
                <span className="text-[var(--canvas-text-3)]">{qualityLearning?.highScorePrompts.length ?? 0} 条</span>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {qualityLearning?.highScorePrompts.map((example) => (
                  <article key={example.id} className="rounded-lg border border-[var(--canvas-node-border)] p-2.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-[var(--canvas-text-3)]">
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">{example.score} 分</span>
                          <span>镜头 {example.shotNo}</span>
                          <span>{example.kind === 'video' ? '视频' : '首尾帧'}</span>
                        </div>
                        <p className="mt-1 truncate text-[10px] text-[var(--canvas-text-2)]" title={example.model}>{example.model}</p>
                        <p className="mt-1 line-clamp-2 break-words text-[10px] leading-relaxed text-[var(--canvas-text-3)]">{example.prompt}</p>
                      </div>
                      <div className="flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          onClick={() => setQualityPromptId(example.id)}
                          className="rounded p-1 text-[var(--canvas-text-3)] hover:bg-white/5 hover:text-[var(--canvas-text-1)]"
                          title="查看完整提示词"
                        >
                          <Eye size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (qualityPromptId === example.id) setQualityPromptId(null);
                            removeQualityPromptExample(example.id);
                          }}
                          className="rounded p-1 text-[var(--canvas-text-3)] hover:bg-red-500/10 hover:text-red-300"
                          title="删除这条高分提示词"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {renderCandidates.length > 0 && (
        <section className="mb-6 rounded-xl border border-[var(--canvas-node-border)] p-4" style={{ background: 'var(--canvas-node-bg)' }}>
          <div>
            <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)]">最终渲染候选评审</h3>
            <p className="mt-1 text-[10px] text-[var(--canvas-text-3)]">播放比较不同成片，只能有一个候选成为当前正式交付绑定。</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {[...renderCandidates].reverse().slice(0, 4).map((candidate) => {
              const accepted = renderCandidateIsAccepted(candidate);
              return (
                <article key={candidate.candidateId} className="overflow-hidden rounded-lg border border-[var(--canvas-node-border)]">
                  <video src={convertFileSrc(candidate.path)} controls preload="metadata" className="aspect-video w-full bg-black object-contain" />
                  <div className="p-2">
                    <p className="truncate text-[10px] text-[var(--canvas-text-2)]" title={candidate.path}>{candidate.path}</p>
                    <p className="mt-1 break-all text-[9px] text-[var(--canvas-text-3)]">{productionCandidateFingerprint(candidate)}</p>
                    <button
                      onClick={() => handleAcceptRender(candidate)}
                      disabled={renderAcceptBusy || accepted}
                      className="mt-2 w-full rounded-md border border-[var(--canvas-node-border)] px-2 py-1.5 text-[10px] text-[var(--canvas-text-1)] hover:border-[var(--canvas-node-border-selected)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {renderAcceptBusy ? '处理中…' : accepted ? '当前正式版本' : '接受并绑定此版本'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <button
            onClick={() => void handleToCanvas()}
            disabled={shotsWithMedia.length === 0 || canvasBusy}
            className="w-full rounded-2xl border border-[var(--canvas-node-border)] p-6 text-left hover:border-[var(--canvas-node-border-selected)] transition-colors disabled:opacity-40"
            style={{ background: 'var(--canvas-node-bg)' }}
          >
            {canvasBusy ? (
              <Loader2 size={20} className="text-[var(--canvas-accent)] mb-3 animate-spin" />
            ) : (
              <LayoutDashboard size={20} className="text-[var(--canvas-accent)] mb-3" />
            )}
            <h3 className="text-[14px] font-medium text-[var(--canvas-text-1)]">
              {canvasImport ? '同步到画布' : '导入画布'}
            </h3>
            <p className="text-[11px] text-[var(--canvas-text-3)] mt-1 leading-relaxed">
              复用已有节点、更新素材版本、仅补缺失项；保留布局与连线
            </p>
            <p className="text-[11px] text-[var(--canvas-text-2)] mt-3">
              {canvasImport
                ? `已于 ${fmtImportDate(canvasImportAt)} 导入（${canvasImportCount} 个）`
                : `${shotsWithMedia.length} 个素材 →`}
            </p>
          </button>
          {canvasError && (
            <p className="mt-1.5 text-[12px]" style={{ color: 'var(--canvas-danger)' }}>
              {canvasError}
            </p>
          )}
        </div>

        <div>
          <button
            onClick={() => void handleToEditor()}
            disabled={shotsWithVideo.length === 0 || busy}
            className="w-full rounded-2xl border border-[var(--canvas-node-border)] p-6 text-left hover:border-[var(--canvas-node-border-selected)] transition-colors disabled:opacity-40"
            style={{ background: 'var(--canvas-node-bg)' }}
          >
            <Scissors size={20} className="text-[var(--canvas-accent)] mb-3" />
            <h3 className="text-[14px] font-medium text-[var(--canvas-text-1)]">
              {editorImport ? '再次导入' : '导入剪辑'}
            </h3>
            <p className="text-[11px] text-[var(--canvas-text-3)] mt-1 leading-relaxed">
              按镜号顺序进入时间轴；未终审素材可先剪辑，正式交付时再校验
            </p>
            <p className="text-[11px] text-[var(--canvas-text-2)] mt-3">
              {editorImport
                ? `已于 ${fmtImportDate(editorImport.at)} 导入（${editorImport.count} 个）`
                : `${shotsWithVideo.length} 段视频 →`}
            </p>
          </button>
          {shotsWithVideo.some(shot => deliveryReviewStatus(shot, reviewerFingerprint).state !== 'passed') && (
            <p className="mt-2 text-[11px] text-[var(--canvas-text-3)]">部分素材尚未通过终审，不影响导入剪辑；逐镜原因见下方交付审核清单。</p>
          )}
          {editorError && (
            <p className="mt-1.5 text-[12px]" style={{ color: 'var(--canvas-danger)' }}>
              {editorError}
            </p>
          )}
        </div>
      </div>

      {shotsWithVideo.length === 0 && (
        <button
          onClick={() => setCurrentStep('generate')}
          className="mt-6 w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--canvas-node-border)] px-4 py-4 text-[12px] text-[var(--canvas-text-2)] hover:border-[var(--canvas-node-border-selected)] hover:text-[var(--canvas-text-1)] transition-colors"
        >
          <Clapperboard size={13} /> 还没有成片视频，点击前往第⑤步生成 →
        </button>
      )}

      <section className="mt-6 rounded-2xl border border-[var(--canvas-node-border)] p-5" style={{ background: 'var(--canvas-node-bg)' }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[14px] font-medium text-[var(--canvas-text-1)]">导出交付包</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--canvas-text-3)]">
              先执行视频容器、checksum、输入包、评审绑定和运行映射校验；通过后导出包含 MP4 与 delivery manifest 的可追溯工程包。
            </p>
          </div>
          <button
            onClick={() => void handleExportDelivery()}
            disabled={deliveryBusy || shotsWithVideo.length === 0}
            className="shrink-0 rounded-lg border border-[var(--canvas-node-border)] px-3 py-2 text-[11px] text-[var(--canvas-text-1)] hover:border-[var(--canvas-node-border-selected)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {deliveryBusy ? <Loader2 size={13} className="mr-1 inline animate-spin" /> : <Download size={13} className="mr-1 inline" />}
            {deliveryBusy ? '校验并导出中…' : '导出交付包'}
          </button>
        </div>
        <button onClick={() => void handleExportPreview()} disabled={deliveryBusy || shotsWithVideo.length === 0}
          className="mt-3 rounded-lg border border-[var(--canvas-node-border)] px-3 py-2 text-[11px] text-[var(--canvas-text-2)] disabled:opacity-40">
          导出内部预览素材包（非正式交付）
        </button>
        <p className="mt-1 text-[10px] text-[var(--canvas-text-3)]">仅导出现有分镜视频及审核清单，不伪造审核通过、不标记交付完成、不重新生成。</p>
        <div className="mt-3 space-y-2">
          {shotsWithVideo.map(shot => {
            const review = deliveryReviewStatus(shot, reviewerFingerprint);
            if (review.state === 'passed') return null;
            return <div key={shot.id || shot.shotNo} className="flex items-start justify-between gap-3 text-[11px] text-[var(--canvas-text-2)]">
              <span>{shot.shotNo}：{review.label}</span>
              <button onClick={() => setCurrentStep('generate')} className="shrink-0 underline">检查采用版本与审核</button>
            </div>;
          })}
        </div>
        {deliveryError && <p className="mt-2 text-[12px]" style={{ color: 'var(--canvas-danger)' }}>{deliveryError}</p>}
      </section>

      {selectedQualityPrompt && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-6" onMouseDown={() => setQualityPromptId(null)}>
          <div
            className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--canvas-node-border)] shadow-2xl"
            style={{ background: 'var(--canvas-node-bg)' }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--canvas-node-border)] px-4 py-3">
              <div>
                <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)]">高分提示词 · 镜头 {selectedQualityPrompt.shotNo}</h3>
                <p className="mt-1 text-[10px] text-[var(--canvas-text-3)]">
                  {selectedQualityPrompt.score} 分 · {selectedQualityPrompt.model} · {new Date(selectedQualityPrompt.createdAt).toLocaleString()}
                </p>
              </div>
              <button type="button" onClick={() => setQualityPromptId(null)} className="rounded p-1 text-[var(--canvas-text-3)] hover:bg-white/5 hover:text-[var(--canvas-text-1)]" title="关闭">
                <X size={15} />
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 text-[11px] leading-relaxed text-[var(--canvas-text-2)]">{selectedQualityPrompt.prompt}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
