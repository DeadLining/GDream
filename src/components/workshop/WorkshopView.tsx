/**
 * WorkshopView — 创作工坊全屏视图（小云雀/火山剧创式 6 步流水线）。
 * 顶栏 + 左 StepNav + 主区当前步骤 + 右抽屉GDream助手。
 */
import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { confirm as tauriConfirm } from '@tauri-apps/api/dialog';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useChatStore } from '@/stores';
import { useAskUserStore } from '@/stores/askUserStore';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { useMemoryStore } from '@/stores/memoryStore';
import GenerationLogTab from '../memory/GenerationLogTab';
import { listProjects, deleteProject, readProjectFile, type AigcProject } from '@/lib/aigc/projectStore';
import { buildProductionAudit } from '@/lib/workshop/productionAudit';
import { qualityReviewerFingerprint } from '@/lib/workshop/qualityReview';
import { getWorkshopNextAction } from '@/lib/workshop/nextAction';
import { WORKSHOP_STEPS, type WorkshopData } from '@/lib/workshop/types';
import { validateAutoRunInput } from '@/lib/workshop/workshopPrompts';
import StepNav from './StepNav';
import WorkshopChatPanel, { dispatchWorkshopPrompt } from './WorkshopChatPanel';
import AiBoxOverlay, { type AiBoxRect } from '@/components/shared/AiBoxOverlay';
import StepScript from './steps/StepScript';
import StepBreakdown from './steps/StepBreakdown';
import StepAssets from './steps/StepAssets';
import StepPrompts from './steps/StepPrompts';
import StepGenerate from './steps/StepGenerate';
import StepHandoff from './steps/StepHandoff';
import TaskQueuePanel from '@/components/canvas/TaskQueuePanel';
import UndoToast from './UndoToast';

interface Props {
  onSendMessage: (content: string, filePaths?: string[]) => Promise<void> | void;
  onAbort: () => void;
}

export default function WorkshopView({ onSendMessage, onAbort }: Props) {
  const project = useWorkshopStore((s) => s.project);
  // 只订阅 currentStep：store 任何写入都会换 data 引用，整订 data 会让整个工坊壳层每次重写
  const currentStep = useWorkshopStore((s) => s.data?.currentStep);
  // 注意：侧边栏开关只在 TopBar 里渲染一次。此前主组件也有一份浮层按钮，
  // 侧边栏收起时两个同时出现、且浮层会压住步骤条，已移除。
  const [queueBusy, setQueueBusy] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [altHeld, setAltHeld] = useState(false);
  const canvasTasks = useCanvasTaskStore((s) => s.tasks);
  const pendingDecision = useAskUserStore((s) => s.pending);
  const autoResumeKeyRef = useRef<string | null>(null);
  const previousActiveTaskIdsRef = useRef<Set<string>>(new Set());

  // 后台生成任务完成后自动重新进入当前项目的续跑链路。此前任务虽然已经
  // 回填成功，但一键全流程只在用户再次点击时执行，项目长期停在 2/6，
  // 用户会误以为 DSH 卡死。这里只在“本项目确有任务从 active 变 terminal”
  // 时触发，并继续遵守确认卡、失败/未知提交和项目归属门控。
  useEffect(() => {
    if (!project?.id) {
      previousActiveTaskIdsRef.current = new Set();
      autoResumeKeyRef.current = null;
      return;
    }
    const active = new Set(
      canvasTasks
        .filter((task) => task.projectId === project.id && ['queued', 'uploading', 'running', 'downloading'].includes(task.status))
        .map((task) => task.id),
    );
    const previous = previousActiveTaskIdsRef.current;
    const completedIds = [...previous].filter((id) => !active.has(id));
    previousActiveTaskIdsRef.current = active;
    if (completedIds.length === 0 || active.size > 0 || pendingDecision) return;
    if (useChatStore.getState().streamingPhase !== 'idle') return;
    const key = `${project.id}:${completedIds.sort().join(',')}`;
    if (autoResumeKeyRef.current === key) return;
    autoResumeKeyRef.current = key;
    const timer = window.setTimeout(() => {
      if (useWorkshopStore.getState().project?.id !== project.id) return;
      if (useAskUserStore.getState().pending || useChatStore.getState().streamingPhase !== 'idle') return;
      dispatchWorkshopPrompt('【继续一键全流程】', { continuation: true });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [canvasTasks, pendingDecision, project?.id]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(false); };
    const blur = () => setAltHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const handleAiBox = (rect: AiBoxRect, instruction: string) => {
    const container = contentRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const absX = box.left + rect.x;
    const absY = box.top + rect.y;
    const items: string[] = [];
    container.querySelectorAll<HTMLElement>('[data-asset-id], [data-shot-no]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > absX && r.left < absX + rect.width && r.bottom > absY && r.top < absY + rect.height) {
        const assetId = el.dataset.assetId;
        const assetKind = el.dataset.assetKind;
        const shotNo = el.dataset.shotNo;
        if (assetId) items.push(`${assetKind}:${assetId}`);
        if (shotNo) items.push(`shot:${shotNo}`);
      }
    });
    const desc = items.length > 0
      ? `用户在工坊中框选了 ${items.length} 个元素：${items.join(', ')}。\n指令：${instruction}`
      : `用户在工坊中画了一个框。\n指令：${instruction}`;
    dispatchWorkshopPrompt(`[工坊 AI 区域操作]\n${desc}`);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 canvas-dark relative" style={{ background: 'var(--canvas-bg)' }}>
      {project && currentStep ? (
        <>
          <TopBar queueBusy={queueBusy} />
          <div className="flex-1 flex min-h-0 relative">
            <StepNav />
            <div ref={contentRef} className="flex-1 min-w-0 overflow-y-auto relative">
              {currentStep === 'script' && <StepScript />}
              {currentStep === 'breakdown' && <StepBreakdown />}
              {currentStep === 'assets' && <StepAssets />}
              {currentStep === 'prompts' && <StepPrompts />}
              {currentStep === 'generate' && <StepGenerate />}
              {currentStep === 'handoff' && <StepHandoff />}
              <AiBoxOverlay active={altHeld} containerRef={contentRef} onSubmit={handleAiBox} onCancel={() => setAltHeld(false)} />
            </div>
            <WorkshopChatPanel onSendMessage={onSendMessage} onAbort={onAbort} onBusyChange={setQueueBusy} />
            <TaskQueuePanel />
            <UndoToast />
          </div>
        </>
      ) : (
        <WorkshopHome />
      )}
    </div>
  );
}

function TopBar({ queueBusy }: { queueBusy: boolean }) {
  const streaming = useChatStore((s) => s.streamingPhase) !== 'idle';
  const [preparing, setPreparing] = useState(false);
  const busy = queueBusy || streaming || preparing;
  const [autoRunError, setAutoRunError] = useState<string | null>(null);
  const autoRunPreparing = useRef(false);
  const project = useWorkshopStore((s) => s.project);
  // steps / currentStep 都是稳定引用或标量：步骤状态或当前步骤不变时 TopBar 不重渲染
  const steps = useWorkshopStore((s) => s.data?.steps);
  const currentStep = useWorkshopStore((s) => s.data?.currentStep);

  if (!project || !steps || !currentStep) return null;
  const doneCount = Object.values(steps).filter((s) => s.status === 'done').length;

  return (
    <div
      className="flex items-center gap-3 px-4 shrink-0 min-w-0 overflow-x-auto"
      style={{ height: 48, background: 'var(--canvas-panel)', borderBottom: '1px solid var(--canvas-node-border)' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Clapperboard size={15} className="text-[var(--canvas-accent)] shrink-0" />
        <span className="text-[14px] font-medium text-[var(--canvas-text-1)] truncate">{project.name}</span>
        <span className="text-[11px] text-[var(--canvas-text-3)]">{doneCount}/6 步完成</span>
      </div>
      <div className="flex-1 min-w-2" />
      <div className="flex items-center gap-2 shrink-0" data-testid="workshop-auto-run-actions">
      <button
        disabled={busy}
        onClick={() => {
          if (autoRunPreparing.current || busy) return;
          autoRunPreparing.current = true;
          setPreparing(true);
          setAutoRunError(null);
          const state = useWorkshopStore.getState();
          void state.commitNow().then(() => {
            if (useWorkshopStore.getState().project?.id !== project.id) return;
            if (useChatStore.getState().streamingPhase !== 'idle') return;
            dispatchWorkshopPrompt('【继续一键全流程】', { continuation: true });
          }).catch(() => setAutoRunError('保存当前进度失败，未提交继续任务，请重试。'))
            .finally(() => { autoRunPreparing.current = false; setPreparing(false); });
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] shrink-0 text-[var(--canvas-text-1)] border border-[var(--canvas-node-border)] hover:bg-[var(--canvas-controls-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
        title={busy ? '当前任务或队列尚未结束，请先处理待确认事项' : '读取已保存进度，只继续缺失工作；不重跑已完成生成，付费仍需确认'}
      >
        <Sparkles size={13} /> 继续一键全流程
      </button>
      <button
        disabled={busy}
        onClick={() => {
          if (autoRunPreparing.current || busy) return;
          autoRunPreparing.current = true;
          setPreparing(true);
          setAutoRunError(null);
          void (async () => {
          // 点击时读取当前数据；实际阶段与模板在串行执行前重新核对。
          const state = useWorkshopStore.getState();
          const data = state.data;
          if (!data || state.project?.id !== project.id) return;
          const inputError = validateAutoRunInput(data, Boolean(state.project.sources.length));
          if (inputError) { setAutoRunError(inputError); return; }
          const settings = useSettingsStore.getState();
          if (data.creativeSpec?.workKind === 'product-ad' && data.creativeSpec.adSpec?.researchMode !== 'provided-only'
            && (!settings.webSearchEnabled || !resolveApiKey(settings, 'tavily', ''))) {
            setAutoRunError('请开启联网并配置 Tavily，或选择「仅用已提供资料」。');
            return;
          }
          await state.commitNow();
          if (useWorkshopStore.getState().project?.id !== project.id) return;
          // Initial start and continuation share the same owner-bound, evidence-gated runner.
          dispatchWorkshopPrompt('【一键全流程】', { continuation: true });
          })().catch(() => setAutoRunError('准备或保存任务失败，请检查项目和任务队列后重试。')).finally(() => { autoRunPreparing.current = false; setPreparing(false); });
        }}
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] shrink-0 text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'var(--canvas-accent)' }}
        title="按保存结果分阶段推进；确认、阻塞或后台生成时暂停，结果就绪后点继续"
      >
        <Sparkles size={13} /> 一键全流程
      </button>
      </div>
      {autoRunError && <p role="alert" className="max-w-[360px] shrink-0 text-xs text-amber-400">{autoRunError}</p>}
    </div>
  );
}

const HOME_TABS = [
  { id: 'projects', label: '项目' },
  { id: 'history', label: '生成记录' },
] as const;
type HomeTab = (typeof HOME_TABS)[number]['id'];

function WorkshopHome() {
  const [projects, setProjects] = useState<AigcProject[]>([]);
  const [workflowSummaries, setWorkflowSummaries] = useState<Record<string, {
    currentStep?: string;
    doneCount: number;
    auditStatus?: 'pass' | 'warn' | 'blocked';
    blockedCount: number;
    nextAction?: string;
    nextActionDetail?: string;
  }>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<HomeTab>('projects');
  const openUnified = useUnifiedProjectStore((s) => s.openUnified);
  const createAndOpen = useWorkshopStore((s) => s.createAndOpen);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const memLoaded = useMemoryStore((s) => s.loaded);
  const loadAll = useMemoryStore((s) => s.loadAll);
  const qualityReviewSettings = useSettingsStore((settings) => ({
    enabled: settings.qualityReviewEnabled,
    baseUrl: settings.qualityReviewBaseUrl,
    model: settings.qualityReviewModel,
  }));

  const refresh = async () => {
    setLoading(true);
    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
      const entries = await Promise.all(nextProjects.map(async (project) => {
        try {
          const raw = await readProjectFile(project.id, 'workshop.json');
          if (!raw) throw new Error('workshop file missing');
          const data = JSON.parse(raw) as WorkshopData;
          const audit = buildProductionAudit(data, {
            videoQualityReviewRequired: qualityReviewSettings.enabled,
            reviewerFingerprint: qualityReviewSettings.enabled
              ? qualityReviewerFingerprint(qualityReviewSettings.baseUrl, qualityReviewSettings.model)
              : undefined,
          });
          const nextAction = getWorkshopNextAction(data, project);
          return [project.id, {
            currentStep: data.currentStep,
            doneCount: Object.values(data.steps ?? {}).filter((step) => step.status === 'done').length,
            auditStatus: audit.status,
            blockedCount: audit.checks.filter((check) => check.status === 'blocked').length,
            nextAction: nextAction.label,
            nextActionDetail: nextAction.detail,
          }] as const;
        } catch {
          return [project.id, { doneCount: 0, blockedCount: 0 }] as const;
        }
      }));
      setWorkflowSummaries(Object.fromEntries(entries));
    } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  // 生成记录懒加载
  useEffect(() => {
    if (tab !== 'projects' && !memLoaded) loadAll();
  }, [tab, memLoaded, loadAll]);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await createAndOpen(`短剧项目 ${new Date().getMonth() + 1}-${new Date().getDate()}`);
      const id = useWorkshopStore.getState().project?.id;
      if (id) await openUnified(id);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (p: AigcProject) => {
    const ok = await tauriConfirm(`删除项目「${p.name}」？目录与产物将一并删除，不可恢复。`, { title: '删除项目', type: 'warning' });
    if (!ok) return;
    await deleteProject(p.id);
    void refresh();
  };

  return (
    <div className="flex-1 overflow-y-auto px-10 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[var(--canvas-text-1)] flex items-center gap-2">
            <img
              src="/gdream-whale.svg"
              alt="GDream"
              className="h-7 w-7 shrink-0 object-contain"
            /> 短剧工坊
          </h1>
          <p className="text-[12px] text-[var(--canvas-text-3)] mt-1">
            项目工坊（剧本→拆解→资产→提示词→生成→交付）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveView('projects')}
            className="px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            项目列表
          </button>
          <button
            onClick={() => void handleCreate()}
            disabled={creating}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--canvas-accent)' }}
          >
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} 新建项目
          </button>
        </div>
      </div>

      {/* Tabs: 项目工坊 + 全局记忆 */}
      <div className="flex gap-1 mb-5 border-b border-[var(--canvas-node-border)]">
        {HOME_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2 text-[13px] transition-colors -mb-px"
            style={{
              color: tab === t.id ? 'var(--canvas-text-1)' : 'var(--canvas-text-3)',
              borderBottom: tab === t.id ? '2px solid var(--canvas-accent)' : '2px solid transparent',
              fontWeight: tab === t.id ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <GenerationLogTab />
      ) : loading ? (
        <div className="text-center py-20 text-[var(--canvas-text-3)] text-sm">
          <Loader2 size={16} className="animate-spin inline mr-2" /> 加载中…
        </div>
      ) : projects.length === 0 ? (
        <button
          onClick={() => void handleCreate()}
          className="w-full py-20 rounded-2xl border border-dashed border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] hover:border-[var(--canvas-node-border-selected)] hover:text-[var(--canvas-text-1)] transition-colors"
        >
          <Plus size={20} className="mx-auto mb-2" />
          <span className="text-[13px]">创建第一个短剧项目</span>
        </button>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group relative rounded-2xl border border-[var(--canvas-node-border)] p-4 cursor-pointer hover:border-[var(--canvas-node-border-selected)] transition-colors"
              style={{ background: 'var(--canvas-node-bg)' }}
              onClick={() => void openUnified(p.id)}
            >
              {(() => {
                const workflow = workflowSummaries[p.id];
                const auditLabel = workflow?.auditStatus === 'pass'
                  ? '审计通过'
                  : workflow?.auditStatus === 'blocked'
                    ? `阻断 ${workflow.blockedCount}`
                    : workflow?.auditStatus === 'warn' ? '有待处理项' : '尚未初始化';
                const auditColor = workflow?.auditStatus === 'pass' ? '#4ade80' : workflow?.auditStatus === 'blocked' ? '#f87171' : '#fbbf24';
                return (
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 text-[10px]">
                    <span style={{ color: auditColor }}>{auditLabel}</span>
                  </div>
                );
              })()}
              <h3 className="text-[14px] font-medium text-[var(--canvas-text-1)] truncate pr-6">{p.name}</h3>
              <p className="text-[11px] text-[var(--canvas-text-3)] mt-1">
                {new Date(p.updatedAt).toLocaleDateString('zh-CN')} · {p.status}
              </p>
              <div className="flex items-center gap-3 mt-3 text-[11px] text-[var(--canvas-text-2)]">
                <span>分镜 {p.stats.shots}</span>
                <span>资产 {p.stats.assets}</span>
                <span>成片 {p.stats.videosCompleted}</span>
              </div>
              {workflowSummaries[p.id] && (
                <div className="mt-2 text-[10px] text-[var(--canvas-text-3)]">
                  流程 {workflowSummaries[p.id].doneCount}/6
                  {workflowSummaries[p.id].currentStep && (
                    <> · 当前：{WORKSHOP_STEPS.find((step) => step.id === workflowSummaries[p.id].currentStep)?.label ?? workflowSummaries[p.id].currentStep}</>
                  )}
                </div>
              )}
              {workflowSummaries[p.id]?.nextAction && (
                <div className="mt-2 truncate text-[10px] text-[var(--canvas-accent)]" title={workflowSummaries[p.id].nextActionDetail}>
                  {workflowSummaries[p.id].nextAction} · {workflowSummaries[p.id].nextActionDetail}
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); void handleDelete(p); }}
                className="absolute top-3 right-3 p-1 rounded opacity-0 group-hover:opacity-100 text-[var(--canvas-text-3)] hover:text-red-400 transition-all"
                title="删除项目"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
