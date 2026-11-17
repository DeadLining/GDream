/**
 * ProjectListView — Adobe-style project console（统一项目首页）。
 *
 * 主区 = AIGC 项目（工坊+画布+剪辑+对话一体），点开走 openUnified；
 * 折叠区 = 未关联工坊的自由画布项目（原画布项目列表）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronRight, CheckCircle2, Clapperboard, Clock, Download, FolderOpen, Loader2, Search,
  Pencil, Trash2, Upload,
} from 'lucide-react';
import { open as openDialog, message as tauriMessage } from '@tauri-apps/api/dialog';
import { useProjectStore, type Project } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { listProjects, deleteProject as deleteAigcProject, readProjectFile, writeProject, type AigcProject } from '@/lib/aigc/projectStore';
import { confirm as tauriConfirm } from '@tauri-apps/api/dialog';
import { readTextFile, exists, BaseDirectory } from '@tauri-apps/api/fs';
import { exportProject, importProject } from '@/lib/projectArchive';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import { filterAigcProjects, summarizeAigcProjects, type AigcProjectFilterStatus } from '@/lib/aigc/portfolioStats';
import { summarizeCanvasTasks } from '@/lib/canvasGen/taskMetrics';
import { summarizePortfolioHealth, type PortfolioAuditSummary } from '@/lib/aigc/portfolioAudit';
import { buildProductionAudit } from '@/lib/workshop/productionAudit';
import { qualityReviewerFingerprint } from '@/lib/workshop/qualityReview';
import { useSettingsStore } from '@/stores/settingsStore';
import type { WorkshopData } from '@/lib/workshop/types';
import { buildPortfolioEvents, type PortfolioEvent } from '@/lib/aigc/portfolioEvents';

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return '刚刚';
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`;
  return `${Math.floor(d / 86400_000)} 天前`;
}

function eventTime(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ts));
}

export default function ProjectListView() {
  const [aigcProjects, setAigcProjects] = useState<AigcProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportingCanvasId, setExportingCanvasId] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectStatus, setProjectStatus] = useState<AigcProjectFilterStatus>('all');
  const [portfolioAudits, setPortfolioAudits] = useState<PortfolioAuditSummary[]>([]);
  const [portfolioEvents, setPortfolioEvents] = useState<PortfolioEvent[]>([]);
  const [showFree, setShowFree] = useState(false);
  const canvasProjects = useProjectStore((s) => s.projects);
  const initialize = useProjectStore((s) => s.initialize);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const openUnified = useUnifiedProjectStore((s) => s.openUnified);
  const qualityReviewSettings = useSettingsStore((settings) => ({
    enabled: settings.qualityReviewEnabled,
    baseUrl: settings.qualityReviewBaseUrl,
    model: settings.qualityReviewModel,
  }));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const projects = await listProjects();
      setAigcProjects(projects);
      const workshops: Record<string, WorkshopData | null> = {};
      const audits = await Promise.all(projects.map(async (project): Promise<PortfolioAuditSummary> => {
        try {
          const raw = await readProjectFile(project.id, 'workshop.json');
          if (!raw) return { projectId: project.id, status: 'unavailable', blockedCount: 0, warningCount: 0 };
          const workshop = JSON.parse(raw) as WorkshopData;
          workshops[project.id] = workshop;
          const report = buildProductionAudit(workshop, {
            videoQualityReviewRequired: qualityReviewSettings.enabled,
            reviewerFingerprint: qualityReviewSettings.enabled
              ? qualityReviewerFingerprint(qualityReviewSettings.baseUrl, qualityReviewSettings.model)
              : undefined,
          });
          return {
            projectId: project.id,
            status: report.status,
            blockedCount: report.checks.filter((item) => item.status === 'blocked').length,
            warningCount: report.checks.filter((item) => item.status === 'warn').length,
            topIssue: report.checks.find((item) => item.status === 'blocked')?.detail
              ?? report.checks.find((item) => item.status === 'warn')?.detail,
          };
        } catch {
          return { projectId: project.id, status: 'unavailable', blockedCount: 0, warningCount: 0 };
        }
      }));
      setPortfolioAudits(audits);
      setPortfolioEvents(buildPortfolioEvents(projects, workshops));
    } finally { setLoading(false); }
  }, [qualityReviewSettings.baseUrl, qualityReviewSettings.enabled, qualityReviewSettings.model]);

  useEffect(() => {
    void initialize();
    void refresh();
  }, [initialize, refresh]);

  const handleOpen = async (p: AigcProject) => {
    try {
      await openUnified(p.id);
      setActiveView('workshop');
    } catch (err) {
      await tauriMessage(`打开项目失败：${err instanceof Error ? err.message : String(err)}`, { title: '打开项目失败' });
    }
  };

  // 查工坊项目对应的画布项目 id（localStorage 画布 projects 反查，或 workshop.json 文件）
  const findCanvasId = async (aigcId: string): Promise<string | undefined> => {
    const cp = useProjectStore.getState().projects.find((p) => p.aigcProjectId === aigcId);
    if (cp) return cp.id;
    try {
      const wsRel = `.gdream/aigc-memory/projects/${aigcId}/workshop.json`;
      if (await exists(wsRel, { dir: BaseDirectory.Home })) {
        const ws = JSON.parse(await readTextFile(wsRel, { dir: BaseDirectory.Home }));
        return ws?.canvasProjectId ?? ws?.data?.canvasProjectId;
      }
    } catch { /* ignore */ }
    return undefined;
  };

  const handleExport = async (p: AigcProject) => {
    if (exportingId) return;
    setExportingId(p.id);
    try {
      const canvasId = await findCanvasId(p.id);
      const zipPath = await exportProject(p.id, canvasId);
      await tauriMessage(`工程已导出到桌面：\n${zipPath}`, { title: '导出成功' });
    } catch (err) {
      await tauriMessage(`导出失败：${err instanceof Error ? err.message : String(err)}`, { title: '导出失败' });
    } finally {
      setExportingId(null);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    try {
      const selected = await openDialog({
        filters: [{ name: 'GDream 工程', extensions: ['zip'] }],
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) return;
      setImporting(true);
      const result = await importProject(selected);
      await refresh();
      await tauriMessage(`已导入工程「${result.name}」并打开`, { title: '导入成功' });
      setActiveView('workshop');
    } catch (err) {
      await tauriMessage(`导入失败：${err instanceof Error ? err.message : String(err)}`, { title: '导入失败' });
    } finally {
      setImporting(false);
    }
  };

  const handleExportCanvas = async (p: Project) => {
    if (exportingCanvasId) return;
    setExportingCanvasId(p.id);
    try {
      // 自由画布无工坊项目，flush 后只打包画布
      await useProjectStore.getState().flushActiveCanvas();
      const zipPath = await exportProject(undefined, p.id);
      await tauriMessage(`画布已导出到桌面：\n${zipPath}`, { title: '导出成功' });
    } catch (err) {
      await tauriMessage(`导出失败：${err instanceof Error ? err.message : String(err)}`, { title: '导出失败' });
    } finally {
      setExportingCanvasId(null);
    }
  };

  const handleDelete = async (p: AigcProject) => {
    const ok = await tauriConfirm(`删除项目「${p.name}」？工坊数据、产物与关联画布将一并删除，不可恢复。`, { title: '删除项目', type: 'warning' });
    if (!ok) return;
    await deleteAigcProject(p.id);
    // 级联删除关联的画布项目，防止幽灵画布堆积
    const ps = useProjectStore.getState();
    const linked = ps.projects.filter((c) => c.aigcProjectId === p.id);
    for (const c of linked) {
      await ps.deleteProject(c.id, true).catch(() => {});
    }
    void refresh();
  };

  const handleRename = async (p: AigcProject, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === p.name) return;
    await writeProject({ ...p, name: trimmed });

    // 1. 同步画布 Project.name（修画布 ProjectSwitcher 显示旧名）
    const ps = useProjectStore.getState();
    const linked = ps.projects.find((c) => c.aigcProjectId === p.id);
    if (linked && linked.name !== trimmed) ps.renameProject(linked.id, trimmed);

    // 2. 同步内存中正打开的工坊 project（修 ProjectTopBar stale）
    const ws = useWorkshopStore.getState();
    if (ws.project?.id === p.id) {
      useWorkshopStore.setState({ project: { ...ws.project, name: trimmed } });
    }

    // 3. 同步会话 title 前缀「旧名 · 对话N」→「新名 · 对话N」（修侧边栏会话组名）
    const oldPrefix = `${p.name} · `;
    const newPrefix = `${trimmed} · `;
    const { sessions, updateSession } = useChatStore.getState();
    for (const s of sessions.filter((x) => x.projectId === p.id)) {
      if (s.title.startsWith(oldPrefix)) {
        updateSession(s.id, { title: newPrefix + s.title.slice(oldPrefix.length) });
      }
    }

    void refresh();
  };

  // 自由画布 = 未关联任何 AIGC 项目的画布项目
  const freeCanvas = canvasProjects.filter((c) => !c.aigcProjectId);

  // 清理空画布（历史 bug 产生的幽灵画布：无节点、未关联）
  const handleCleanupEmpty = async () => {
    const ps = useProjectStore.getState();
    const orphans = ps.projects.filter((c) => !c.aigcProjectId);
    let removed = 0;
    for (const c of orphans) {
      try {
        const rel = `.gdream/projects/${c.id}/canvas.json`;
        let empty = true;
        if (await exists(rel, { dir: BaseDirectory.Home })) {
          const raw = await readTextFile(rel, { dir: BaseDirectory.Home });
          const parsed = JSON.parse(raw) as { nodes?: unknown[] };
          empty = !parsed.nodes || parsed.nodes.length === 0;
        }
        if (empty && ps.projects.length - removed > 1 && c.id !== ps.activeProjectId) {
          await ps.deleteProject(c.id, true);
          removed++;
        }
      } catch { /* skip unreadable */ }
    }
    await tauriMessage(removed > 0 ? `已清理 ${removed} 个空画布` : '没有可清理的空画布', { title: '清理空画布' });
  };
  const coverFor = (p: AigcProject): string | undefined =>
    canvasProjects.find((c) => c.aigcProjectId === p.id)?.coverUrl;

  const sorted = [...aigcProjects].sort((a, b) => b.updatedAt - a.updatedAt);
  const portfolio = useMemo(() => summarizeAigcProjects(aigcProjects), [aigcProjects]);
  const visibleProjects = useMemo(() => filterAigcProjects(sorted, projectQuery, projectStatus), [projectQuery, projectStatus, sorted]);
  const recentProject = sorted[0];
  const canvasTasks = useCanvasTaskStore((s) => s.tasks);
  const taskMetrics = useMemo(() => summarizeCanvasTasks(canvasTasks), [canvasTasks]);
  const portfolioHealth = useMemo(() => summarizePortfolioHealth(portfolioAudits), [portfolioAudits]);
  const nextStepLabel = recentProject?.status === 'draft'
    ? '上传剧本或输入 Idea'
    : recentProject?.status === 'parsed'
      ? '审核拆解并生成资产'
      : recentProject?.status === 'assets-ready'
        ? '生成原子镜头提示词'
        : recentProject?.status === 'prompts-ready'
          ? '生成并评审候选视频'
          : recentProject?.status === 'video-generating'
            ? '等待任务完成并评审'
            : recentProject?.status === 'completed'
              ? '检查交付清单'
              : '继续当前工坊步骤';

  return (
    <div className="canvas-dark flex-1 overflow-y-auto bg-[var(--canvas-bg)]">
      <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-[var(--canvas-text-1)]">项目</h1>
            <p className="text-[13px] text-[var(--canvas-text-3)] mt-0.5">
              每个项目 = 工坊流水线 + 专属画布 + 剪辑时间轴 + 项目对话
            </p>
          </div>
          <div className="mb-5 flex max-w-2xl flex-wrap items-center gap-2">
          <label className="flex min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-3 py-2 text-[var(--canvas-text-3)] shadow-sm">
            <Search size={15} />
            <input
              value={projectQuery}
              onChange={(event) => setProjectQuery(event.target.value)}
              placeholder="搜索项目名称、slug 或 ID"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--canvas-text-1)] outline-none placeholder:text-[var(--canvas-text-3)]"
              aria-label="搜索项目"
            />
          </label>
          <select
            value={projectStatus}
            onChange={(event) => setProjectStatus(event.target.value as AigcProjectFilterStatus)}
            className="rounded-xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-3 py-2 text-[13px] text-[var(--canvas-text-2)] outline-none shadow-sm"
            aria-label="按项目状态筛选"
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="parsed">已拆解</option>
            <option value="assets-ready">资产就绪</option>
            <option value="prompts-ready">提示词就绪</option>
            <option value="video-generating">视频生成中</option>
            <option value="completed">已完成</option>
          </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleImport()}
              disabled={importing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--canvas-node-bg)] hover:bg-[var(--canvas-panel-elevated)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-1)] text-[13px] font-medium transition-colors disabled:opacity-50"
              title="从 zip 导入 GDream 工程"
            >
              {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}导入工程
            </button>
          </div>
        </div>


        {sorted.length > 0 && (
          <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
            <button onClick={() => recentProject && void handleOpen(recentProject)} className="rounded-2xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] p-4 text-left transition-colors hover:border-[var(--canvas-node-border-selected)]">
              <div className="text-[11px] text-[var(--canvas-text-3)]">最近项目</div>
              <div className="mt-1 truncate text-[14px] font-medium text-[var(--canvas-text-1)]">{recentProject?.name}</div>
              <div className="mt-1 text-[11px] text-[var(--canvas-text-3)]">{timeAgo(recentProject?.updatedAt ?? 0)} · 分镜 {recentProject?.stats.shots ?? 0}</div>
            </button>
            <div className="rounded-2xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] p-4">
              <div className="text-[11px] text-[var(--canvas-text-3)]">运行状态</div>
              <div className="mt-1 flex items-center gap-2 text-[14px] font-medium text-[var(--canvas-text-1)]">
                {taskMetrics.active > 0 ? <Loader2 size={14} className="animate-spin text-[var(--canvas-warning)]" /> : <CheckCircle2 size={14} className="text-[var(--canvas-success)]" />}
                {taskMetrics.active > 0 ? `${taskMetrics.active} 个任务运行中` : '没有运行中的任务'}
              </div>
              <div className="mt-1 text-[11px] text-[var(--canvas-text-3)]">排队 {taskMetrics.queued} · 可恢复 {taskMetrics.recoverable} · 失败 {taskMetrics.failed}</div>
            </div>
            <div className="rounded-2xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] p-4">
              <div className="text-[11px] text-[var(--canvas-text-3)]">下一步</div>
              <div className="mt-1 text-[14px] font-medium text-[var(--canvas-text-1)]">{nextStepLabel}</div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--canvas-text-3)]"><AlertTriangle size={11} />以最近更新项目为准</div>
            </div>
            <div className="rounded-2xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] p-4">
              <div className="text-[11px] text-[var(--canvas-text-3)]">全局生产统计</div>
              <div className="mt-1 text-[14px] font-medium text-[var(--canvas-text-1)]">{portfolio.projectCount} 个项目 · {portfolio.shotCount} 个镜头</div>
              <div className="mt-1 text-[11px] text-[var(--canvas-text-3)]">进行中 {portfolio.activeProjectCount} · 已完成视频 {portfolio.completedVideoCount}</div>
              <div className="mt-1 text-[11px] text-[var(--canvas-text-3)]">阻断 {portfolioHealth.blockedProjectCount} · 待处理 {portfolioHealth.warningProjectCount} · 未审计 {portfolioHealth.unavailableProjectCount}</div>
            </div>
          </div>
        )}

        {portfolioEvents.length > 0 && (
          <section className="mb-6 rounded-2xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] p-4 shadow-sm" aria-label="跨项目活动">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--canvas-text-3)]">最近活动</div>
                <div className="mt-1 text-[13px] text-[var(--canvas-text-2)]">跨项目生产动态（来源于项目与工坊现有记录）</div>
              </div>
              <span className="text-[11px] text-[var(--canvas-text-3)]">{portfolioEvents.length} 条</span>
            </div>
            <div className="grid max-h-52 gap-1.5 overflow-y-auto">
              {portfolioEvents.slice(0, 8).map((event) => (
                <button
                  key={event.id}
                  onClick={() => { const target = aigcProjects.find((project) => project.id === event.projectId); if (target) void handleOpen(target); }}
                  className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[var(--canvas-controls-hover)]"
                  title="打开项目"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${event.kind === 'project' ? 'bg-[var(--canvas-text-3)]' : 'bg-[var(--canvas-accent)]'}`} />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--canvas-text-2)]"><b className="font-medium text-[var(--canvas-text-1)]">{event.projectName}</b> · {event.label} · {event.detail}</span>
                  <span className="shrink-0 text-[10px] text-[var(--canvas-text-3)]">{eventTime(event.at)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {loading ? (
          <div className="text-center py-20 text-[var(--canvas-text-3)] text-sm">
            <Loader2 size={16} className="animate-spin inline mr-2" />加载中…
          </div>
        ) : sorted.length === 0 ? (
          <button
            onClick={() => setActiveView('workshop')}
            className="w-full py-20 rounded-2xl border-2 border-dashed border-[var(--canvas-node-border)] text-[var(--canvas-text-3)] hover:border-[var(--canvas-node-border-selected)] hover:text-[var(--canvas-text-2)] transition-colors"
          >
            <Clapperboard size={22} className="mx-auto mb-2" />
            <span className="text-sm">还没有项目，去「短剧工坊」新建</span>
          </button>
        ) : visibleProjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] py-16 text-center text-sm text-[var(--canvas-text-3)]">
            没有匹配“{projectQuery}”的项目
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {visibleProjects.map((p) => (
              <AigcProjectCard
                key={p.id}
                project={p}
                coverUrl={coverFor(p)}
                onOpen={() => void handleOpen(p)}
                onDelete={() => void handleDelete(p)}
                onRename={(name) => void handleRename(p, name)}
                onExport={() => void handleExport(p)}
                exporting={exportingId === p.id}
                audit={portfolioAudits.find((item) => item.projectId === p.id)}
              />
            ))}
          </div>
        )}

        {/* 自由画布折叠区 */}
        {freeCanvas.length > 0 && (
          <div className="mt-10">
            <button
              onClick={() => setShowFree((v) => !v)}
              className="flex items-center gap-1.5 text-[13px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors mb-3"
            >
              {showFree ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              自由画布（{freeCanvas.length}）
              <span className="text-[11px] text-[var(--canvas-text-3)] ml-1">未关联工坊的独立画布</span>
            </button>
            {showFree && (
              <button
                onClick={() => void handleCleanupEmpty()}
                className="mb-3 ml-5 text-[11px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-danger)] transition-colors"
              >
                清理空画布
              </button>
            )}
            {showFree && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {freeCanvas.map((c) => (
                  <FreeCanvasCard
                    key={c.id}
                    project={c}
                    onExport={() => void handleExportCanvas(c)}
                    exporting={exportingCanvasId === c.id}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AigcProjectCard({ project, coverUrl, onOpen, onDelete, onRename, onExport, exporting, audit }: {
  project: AigcProject;
  coverUrl?: string;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onExport: () => void;
  exporting: boolean;
  audit?: PortfolioAuditSummary;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);

  return (
    <div className="group relative rounded-2xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] overflow-hidden transition-shadow hover:shadow-lg">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="h-32 bg-[var(--canvas-panel)] flex items-center justify-center overflow-hidden">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <Clapperboard size={28} className="text-[var(--canvas-text-3)]" />
          )}
          {audit && (
            <span
              className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium shadow-sm ${
                audit.status === 'blocked'
                  ? 'border-[rgba(255,97,99,0.35)] bg-[rgba(255,97,99,0.12)] text-[var(--canvas-danger)]'
                  : audit.status === 'warn'
                    ? 'border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.12)] text-[var(--canvas-warning)]'
                    : audit.status === 'pass'
                      ? 'border-[rgba(4,184,76,0.35)] bg-[rgba(4,184,76,0.12)] text-[var(--canvas-success)]'
                      : 'border-[var(--canvas-node-border)] bg-[var(--canvas-panel-elevated)] text-[var(--canvas-text-2)]'
              }`}
              title={audit.topIssue}
            >
              {audit.status === 'pass' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
              {audit.status === 'blocked'
                ? `阻断 ${audit.blockedCount}`
                : audit.status === 'warn'
                  ? `待处理 ${audit.warningCount}`
                  : audit.status === 'pass' ? '审计通过' : '未审计'}
            </span>
          )}
        </div>
        <div className="px-3.5 py-3">
          {editing ? (
            <input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { onRename(name); setEditing(false); }
                if (e.key === 'Escape') { setName(project.name); setEditing(false); }
              }}
              onBlur={() => { onRename(name); setEditing(false); }}
              className="w-full text-sm font-medium text-[var(--canvas-text-1)] bg-[var(--canvas-bg)] border border-[var(--canvas-node-border)] rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-[rgba(2,133,255,0.5)]"
            />
          ) : (
            <span className="text-sm font-medium text-[var(--canvas-text-1)] truncate block">{project.name}</span>
          )}
          <div className="flex items-center gap-2.5 mt-1.5 text-[11px] text-[var(--canvas-text-3)]">
            <span className="flex items-center gap-1"><Clock size={10} />{timeAgo(project.updatedAt)}</span>
            <span>分镜 {project.stats.shots}</span>
            <span>成片 {project.stats.videosCompleted}</span>
          </div>
          {audit?.topIssue && audit.status !== 'pass' && (
            <p className={`mt-2 line-clamp-2 text-[10px] leading-4 ${audit.status === 'blocked' ? 'text-[var(--canvas-danger)]' : 'text-[var(--canvas-warning)]'}`}>
              下一项：{audit.topIssue}
            </p>
          )}
        </div>
      </button>
      <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={(e) => { e.stopPropagation(); onExport(); }} disabled={exporting} className="p-1.5 rounded-lg bg-[var(--canvas-panel-elevated)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)] shadow-sm disabled:opacity-50" title="导出工程到桌面">
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        </button>
        <button onClick={(e) => { e.stopPropagation(); setEditing(true); }} className="p-1.5 rounded-lg bg-[var(--canvas-panel-elevated)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)] shadow-sm" title="重命名">
          <Pencil size={12} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 rounded-lg bg-[var(--canvas-panel-elevated)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-3)] hover:text-[var(--canvas-danger)] shadow-sm" title="删除项目">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function FreeCanvasCard({ project, onExport, exporting }: {
  project: Project;
  onExport: () => void;
  exporting: boolean;
}) {
  const switchProject = useProjectStore((s) => s.switchProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const setActiveView = useChatStore((s) => s.setActiveView);

  const handleOpen = async () => {
    // 自由画布：关掉统一项目再切，避免 ProjectTopBar 误显
    await useUnifiedProjectStore.getState().closeUnified();
    await switchProject(project.id);
    setActiveView('canvas');
  };

  const handleDelete = async () => {
    const ok = await tauriConfirm(`删除画布「${project.name}」？（文件保留在磁盘）`, { title: '删除画布' });
    if (!ok) return;
    try {
      await deleteProject(project.id, false);
    } catch (err) {
      await tauriMessage(err instanceof Error ? err.message : String(err), { title: '无法删除' });
    }
  };

  return (
    <div className="group relative rounded-2xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] overflow-hidden transition-shadow hover:shadow-md">
      <button onClick={() => void handleOpen()} className="block w-full text-left">
        <div className="h-24 bg-[var(--canvas-panel)] flex items-center justify-center overflow-hidden">
          {project.coverUrl ? (
            <img src={project.coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <FolderOpen size={24} className="text-[var(--canvas-text-3)]" />
          )}
        </div>
        <div className="px-3 py-2.5">
          <span className="text-[13px] font-medium text-[var(--canvas-text-2)] truncate block">{project.name}</span>
          <span className="text-[10px] text-[var(--canvas-text-3)]">{timeAgo(project.updatedAt)}</span>
        </div>
      </button>
      <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onExport(); }}
          disabled={exporting}
          className="p-1.5 rounded-lg bg-[var(--canvas-panel-elevated)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)] shadow-sm disabled:opacity-50"
          title="导出画布到桌面"
        >
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); void handleDelete(); }}
          className="p-1.5 rounded-lg bg-[var(--canvas-panel-elevated)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-3)] hover:text-[var(--canvas-danger)] shadow-sm"
          title="删除"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
