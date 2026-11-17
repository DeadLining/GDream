import { buildSynopsisRewritePrompt } from '@/lib/workshop/synopsisRewrite';
import { buildBreakdownResumePrompt } from '@/lib/workshop/breakdownIntent';
import { useChatStore } from '@/stores/chatStore';
import { breakdownWorkUnits, pendingBreakdownUnits } from '@/lib/workshop/breakdownQueue';
/**
 * StepBreakdown — ②拆解：梗概 / 分集分场 / 角色档案，全部可编辑。
 * 编辑即写 store（梗概/分集触发 invalidateDownstream）。
 */
import { Fragment, useEffect, useState } from 'react';
import { AlertTriangle, Plus, Sparkles, Trash2, User, Wand2 } from 'lucide-react';
import { confirm as tauriConfirm } from '@tauri-apps/api/dialog';
import { useShallow } from 'zustand/react/shallow';
import { useWorkshopStore } from '@/stores/workshopStore';
import type { WsCharacter } from '@/lib/workshop/types';
import { validateCharacterHandoffs } from '@/lib/workshop/characterContinuity';
import { breakdownActionLabel, breakdownCompletionReasons } from '@/lib/workshop/stepStatus';
import { buildAtomicResplitPrompt, buildBreakdownPrompt, buildScriptRepairPrompt } from '@/lib/workshop/workshopPrompts';
import { listProjectFiles, readProjectFile } from '@/lib/aigc/projectStore';
import {
  buildRejectedBatchRepairPrompt,
  parseRejectedShotBatch,
  summarizeRejectedBatch,
  type RejectedShotBatch,
} from '@/lib/workshop/rejectedBatch';
import { dispatchWorkshopPrompt } from '../WorkshopChatPanel';
import { buildStyleSection } from '../StyleSelector';
import SmartTextarea from '../SmartTextarea';

const inputCls = 'bg-transparent text-[12px] text-[var(--canvas-text-1)] focus:outline-none placeholder:text-[var(--canvas-text-3)] w-full rounded transition-colors hover:bg-[rgba(255,255,255,0.04)] focus:bg-[rgba(255,255,255,0.04)] focus:shadow-[inset_0_-1px_0_0_var(--canvas-accent)]';
const cardCls = 'rounded-xl border border-[var(--canvas-node-border)] p-3.5';

export default function StepBreakdown() {
  const busy = useChatStore((s) => s.streamingPhase !== 'idle');
  // 浅比较对象选择器：只在本页用到的字段变化时才重渲染（logChange/shots 等写入不波及本页）
  const data = useWorkshopStore(useShallow((s) => s.data && ({
    breakdownWork: s.data.breakdownWork,
    synopsis: s.data.synopsis,
    episodes: s.data.episodes,
    characters: s.data.characters,
    scenes: s.data.scenes,
    props: s.data.props,
    narrativeBeats: s.data.narrativeBeats,
    shots: s.data.shots,
    currentScriptRevisionId: s.data.currentScriptRevisionId,
    scriptRevisions: s.data.scriptRevisions,
    scriptReview: s.data.scriptReview,
    directorReport: s.data.directorReport,
    characterHandoffs: s.data.characterHandoffs,
    videoPromptTemplate: s.data.videoPromptTemplate,
    breakdownStatus: s.data.steps.breakdown.status,
  })));
  const setSynopsis = useWorkshopStore((s) => s.setSynopsis);
  const setEpisodes = useWorkshopStore((s) => s.setEpisodes);
  const upsertCharacters = useWorkshopStore((s) => s.upsertCharacters);
  const removeCharacter = useWorkshopStore((s) => s.removeCharacter);
  const getAssetRefInfo = useWorkshopStore((s) => s.getAssetRefInfo);
  const markStepStatus = useWorkshopStore((s) => s.markStepStatus);
  const creativeSpec = useWorkshopStore((s) => s.data?.creativeSpec);
  const [episodeBusy, setEpisodeBusy] = useState<string | null>(null);
  const [rejectedBatch, setRejectedBatch] = useState<RejectedShotBatch | null>(null);
  const projectId = useWorkshopStore((s) => s.project?.id);

  // 载入最近一次被整批拒绝的分镜批次，供“针对错误修复并重提”按钮使用
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!projectId) return;
      const files = await listProjectFiles(projectId, 'breakdown/rejected-shots').catch(() => []);
      const sorted = files.filter((name) => name.endsWith('.json')).sort();
      if (sorted.length === 0) {
        if (!cancelled) setRejectedBatch(null);
        return;
      }
      const raw = await readProjectFile(projectId, `breakdown/rejected-shots/${sorted[sorted.length - 1]}`).catch(() => null);
      const parsed = parseRejectedShotBatch(raw);
      // 若这批镜号现在已全部写入成功，说明失败批次已被修复，隐藏旧记录避免误导。
      const existingNos = new Set((useWorkshopStore.getState().data?.shots ?? []).map((shot) => shot.shotNo));
      const allResolved = parsed
        && parsed.shots.length > 0
        && parsed.shots.every((shot) => typeof shot.shotNo === 'string' && existingNos.has(shot.shotNo));
      if (!cancelled) setRejectedBatch(allResolved ? null : parsed);
    };
    void load();
    return () => { cancelled = true; };
  }, [projectId, data?.shots.length]);

  const breakdownReady = !!data && breakdownCompletionReasons(data).length === 0;
  const breakdownStatus = data?.breakdownStatus;
  useEffect(() => {
    // Never infer full completion from a nonempty shot list. Only explicit task completion marks done.
    if (!breakdownReady && breakdownStatus === 'done') markStepStatus('breakdown', 'in-progress');
  }, [breakdownReady, breakdownStatus, markStepStatus]);

  if (!data) return null;
  const characterHandoffIssues = validateCharacterHandoffs(data);
  const completionReasons = breakdownCompletionReasons(data);
  const sourceUnits = breakdownWorkUnits(data);
  const pendingUnits = pendingBreakdownUnits(data);
  const scriptNeedsRepair = Boolean(
    data.currentScriptRevisionId
    && data.scriptReview?.revisionId === data.currentScriptRevisionId
    && data.scriptReview.status === 'needs-repair',
  );
  const patchChar = (id: string, patch: Partial<WsCharacter>) => {
    const c = data.characters.find((x) => x.id === id);
    if (c) upsertCharacters([{ ...c, ...patch }]);
  };

  const generateEpisodeScript = (episodeNo: string) => {
    const episode = data.episodes.find((item) => item.no === episodeNo);
    if (!episode || episodeBusy) return;
    setEpisodeBusy(episodeNo);
    // Mirror the AI breakdown path: reread the authoritative episode-script
    // state first, then regenerate from the latest approved plan/script.
    // Do not feed stale local synopsis fields back as creative constraints.
    dispatchWorkshopPrompt(`请只为当前工坊项目重写第 ${episode.no} 集《${episode.title || `第${episode.no}集`}》的完整剧本，并覆盖该集旧正文；不要写其他集，不要拆分镜头。

执行要求：这是第二阶段第 ${episode.no} 集的“按当前最新规划重走剧本生成”操作。
1. 先调用 workshop_get_state(detail:"step", section:"episode-script")，完整读取当前源文、审核记录、latest 故事规划、创作设置、真实角色/场景/道具与全季分集摘要；如有 next_call 必须按原样读完。
2. 再调用 workshop_get_state(detail:"step", section:"episode-script", episode:"${episode.no}")，读取本集最新 episode 规划、Beat、上一集结束状态与真实资产。若当前 episode 的 synopsis/openingState/centralConflict/climax/endingState 与本集旧正文冲突，以当前已保存的季纲/规划为准。
3. 当前 episode 旧正文只作为需要保留的事实与对白参考，不作为不可改变的上限；不得把旧正文里的对白数量、场景数量、招式数量等执行性限制继续写进新稿。用户在本轮之前的最新 Idea、创作设置与当前规划优先。
4. 这是真正的剧本创作阶段：按当前规划写出完整场次、自然对白、人物动机与阻力、动作、情绪、听者反应、环境反馈、潜台词、进入/离开状态；${creativeSpec?.episodeDurationSec ?? 90}秒只是参考，先按自然语速、停顿、话轮交接、必要动作与反应推导实际时长，可内部延长并汇报。不加速、不删词卡秒数，不为凑数或遵守旧稿压成固定句数。
5. 角色档案、场景资产档案、道具资产档案分别写入 workshop_set_episode_script 的对应字段；script 字段只写可直接用于拆解的剧本正文，不要把“本集目标与情绪曲线/爽点说明/资产档案”混进剧本正文。
6. 生成后必须调用 workshop_set_episode_script 保存到 episode_no="${episode.no}"，status="draft"，覆盖本集旧正文。保存成功后汇报并结束；不要在本轮拆分镜头，不要跳转文案工作室，不要创建文案文档，不要要求手动导入，不刷新或重新读取全项目。`);
    setEpisodeBusy(null);
  };

  // 针对错误修复：把落盘的原始 payload + 逐条 error 交给 agent 做最小字段修复后重提
  const repairRejectedBatch = () => {
    if (!rejectedBatch) return;
    dispatchWorkshopPrompt(buildRejectedBatchRepairPrompt(rejectedBatch));
  };

  // 角色删除是全局级联删除：先确认影响范围，store 会同步清理分镜引用
  const handleRemoveCharacter = async (id: string) => {
    const info = getAssetRefInfo('character', id);
    const impact = info.shots > 0
      ? `将同步从 ${info.shots} 个分镜中移除引用，并标记这些分镜提示词需刷新。`
      : '没有分镜引用它。';
    if (!(await tauriConfirm(`删除「${info.name}」？${impact}`))) return;
    removeCharacter(id);
  };

  return (
    <div className="max-w-[860px] mx-auto px-8 py-8 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--canvas-text-1)]">② 剧本拆解</h2>
          <p className="text-[12px] text-[var(--canvas-text-3)] mt-1">梗概 · 分集分场 · 角色档案 — 可手动修改，也可让右侧助手重做</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (scriptNeedsRepair) {
                dispatchWorkshopPrompt(buildScriptRepairPrompt());
                return;
              }
              void buildStyleSection().then((sec) => dispatchWorkshopPrompt(
                data.shots.length > 0 && completionReasons.length === 0
                  ? buildAtomicResplitPrompt(sec, creativeSpec?.episodeDurationSec, creativeSpec?.format ?? 'short-film')
                  : buildBreakdownPrompt(sec, completionReasons, creativeSpec?.format ?? 'short-film', creativeSpec?.episodeDurationSec),
              ));
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            <Sparkles size={12} /> {breakdownActionLabel({ scriptNeedsRepair, shotCount: data.shots.length, incomplete: completionReasons.length > 0 })}
          </button>
        </div>
      </div>

      {data.breakdownWork && sourceUnits.length > 0 && (
        <div className="mt-4 rounded-xl border border-[var(--canvas-node-border)] p-3 text-[12px] text-[var(--canvas-text-2)]" role="status">
          正文拆解进度：{sourceUnits.length - pendingUnits.length}/{sourceUnits.length} 段已登记保存 · 当前 {data.shots.length} 镜
          <div className="mt-1 text-[11px] text-[var(--canvas-text-3)]">
            {pendingUnits[0] ? `接续位置：第 ${pendingUnits[0].episode} 集，第 ${pendingUnits[0].index + 1} 段。继续时保留已写内容。` : '现有正式正文片段均已登记；全流程会继续核对其他分集及后续阶段。'}
            这是执行进度，不是镜头质量评分。
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => dispatchWorkshopPrompt(buildBreakdownResumePrompt())}
              className="rounded-lg border border-[var(--canvas-node-border)] px-3 py-1.5 text-[var(--canvas-text-2)] disabled:opacity-50">
              核对并补齐拆解
            </button>
            <button type="button" disabled={busy}
              onClick={() => dispatchWorkshopPrompt('【继续一键全流程】', { continuation: true })}
              className="rounded-lg border border-[var(--canvas-accent)] px-3 py-1.5 text-[var(--canvas-accent)] disabled:opacity-50">
              继续一键全流程
            </button>
          </div>
          <div className="mt-1 text-[11px] text-[var(--canvas-text-3)]">
            仅核对拆解不会启动资产或视频生成。继续全流程会从已保存进度接续后续阶段；保留已有成果，遇到待确认事项或后台任务会暂停，不重复提交。
          </div>
        </div>
      )}

      {rejectedBatch && (
        <section className="mt-4 rounded-xl border border-red-500/30 p-3.5" style={{ background: 'rgba(220,38,38,0.06)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-red-200">
                <AlertTriangle size={13} /> 有一批分镜未写入（{summarizeRejectedBatch(rejectedBatch)}）
              </h3>
              <p className="mt-1 text-[10px] text-[var(--canvas-text-3)]">
                本批尚未进入分镜表，原始数据与错误已保留。此按钮会修复待提交数据并重新写入，不是修改已有镜头；不需要先生成资产。
              </p>
              <details className="mt-2 group">
                <summary className="cursor-pointer text-[10px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]">查看原始错误</summary>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--canvas-node-border)] bg-black/30 p-2 text-[10px] leading-relaxed text-[var(--canvas-text-2)]">{rejectedBatch.error || '（错误缺失）'}</pre>
              </details>
            </div>
            <button
              onClick={repairRejectedBatch}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-400/40 px-3 py-1.5 text-[12px] text-red-100 hover:bg-red-500/15 transition-colors"
            >
              <Wand2 size={12} /> 针对错误修复并重提
            </button>
          </div>
        </section>
      )}

      {(data.characterHandoffs?.length ?? 0) > 0 && (
        <section className="mt-4 rounded-xl border border-[var(--canvas-node-border)] p-3.5" style={{ background: 'var(--canvas-node-bg)' }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)]">跨集人物连续性</h3>
              <p className="mt-1 text-[10px] text-[var(--canvas-text-3)]">已记录 {data.characterHandoffs?.length} 条 handoff；跨集状态、变体和身份变化由作者显式确认。</p>
            </div>
            <span className={`rounded-full px-2 py-1 text-[10px] ${characterHandoffIssues.length === 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
              {characterHandoffIssues.length === 0 ? '连续性通过' : `${characterHandoffIssues.length} 项问题`}
            </span>
          </div>
          {characterHandoffIssues.length > 0 && <div className="mt-2 space-y-1 text-[10px] text-red-200/80">{characterHandoffIssues.slice(0, 4).map((issue) => <div key={`${issue.handoffId}-${issue.message}`}>· {issue.message}</div>)}</div>}
        </section>
      )}

      {/* 梗概 */}
      <section className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)]">故事梗概</h3>
          <button type="button" disabled={busy}
            onClick={() => dispatchWorkshopPrompt(buildSynopsisRewritePrompt())}
            title="仅重写故事梗概，不重新拆解或生成媒体"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--canvas-accent)] hover:bg-white/5 disabled:opacity-40">
            <Sparkles size={12} /> 重写梗概
          </button>
        </div>
        <SmartTextarea
          value={data.synopsis}
          onChange={setSynopsis}
          placeholder="点击「AI 拆解」自动生成，或手动填写…"
          rows={4}
          editorTitle="故事梗概"
          className={`${cardCls} w-full resize-y bg-[rgba(255,255,255,0.03)] text-[12px] leading-relaxed text-[var(--canvas-text-1)] focus:outline-none focus:border-[var(--canvas-node-border-selected)] placeholder:text-[var(--canvas-text-3)]`}
        />
      </section>

      {/* 分集分场 */}
      <section className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)]">分集分场</h3>
          <button
            onClick={() => setEpisodes([...data.episodes, { no: String(data.episodes.length + 1), title: '', sceneList: '' }])}
            className="flex items-center gap-1 text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            <Plus size={11} /> 加一集
          </button>
        </div>
        {data.episodes.length === 0 ? (
          <p className="text-[11px] text-[var(--canvas-text-3)] py-3">（暂无，AI 拆解后自动填充）</p>
        ) : (
          <div className="rounded-xl border border-[var(--canvas-node-border)] overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[var(--canvas-text-3)]" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <th className="px-3 py-2 w-14 font-normal">集</th>
                  <th className="px-3 py-2 w-44 font-normal">标题</th>
                  <th className="px-3 py-2 font-normal">场次</th>
                  <th className="w-9" />
                </tr>
              </thead>
              <tbody>
                {data.episodes.map((ep, i) => (
                  <Fragment key={ep.no || i}>
                  <tr key={`${ep.no}-row`} className="border-t border-[var(--canvas-node-border)]">
                    <td className="px-3 py-2">
                      <input className={inputCls} value={ep.no} onChange={(e) => {
                        const next = [...data.episodes]; next[i] = { ...ep, no: e.target.value }; setEpisodes(next);
                      }} />
                    </td>
                    <td className="px-3 py-2">
                      <input className={inputCls} value={ep.title} placeholder="标题" onChange={(e) => {
                        const next = [...data.episodes]; next[i] = { ...ep, title: e.target.value }; setEpisodes(next);
                      }} />
                    </td>
                    <td className="px-3 py-2">
                      <input className={inputCls} value={ep.sceneList} placeholder="场次概览，分号分隔" onChange={(e) => {
                        const next = [...data.episodes]; next[i] = { ...ep, sceneList: e.target.value }; setEpisodes(next);
                      }} />
                    </td>
                    <td className="px-2">
                      <button
                        onClick={() => setEpisodes(data.episodes.filter((_, j) => j !== i))}
                        className="p-1.5 rounded text-[var(--canvas-text-3)] hover:text-red-400 transition-colors"
                        title="删除本集"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                  <tr key={`${ep.no}-detail`} className="border-t border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.018)]">
                    <td colSpan={4} className="relative px-3 py-2">
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          ['synopsis', '本集梗概'],
                          ['openingState', '开场状态'],
                          ['centralConflict', '核心冲突'],
                          ['climax', '高潮事件'],
                          ['endingState', '结尾状态'],
                          ['cliffhanger', '追更钩子'],
                        ] as const).map(([field, label]) => (
                          <label key={field} className="block">
                            <span className="mb-1 block text-[10px] text-[var(--canvas-text-3)]">{label}</span>
                            <textarea
                              className={`${inputCls} min-h-10 resize-y border border-[var(--canvas-node-border)] px-2 py-1 leading-relaxed`}
                              value={ep[field] ?? ''}
                              placeholder={`AI 生成${label}…`}
                              onChange={(e) => {
                                const next = [...data.episodes]; next[i] = { ...ep, [field]: e.target.value }; setEpisodes(next);
                              }}
                            />
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--canvas-text-3)]">
                        <span>剧本状态：{ep.scriptStatus === 'frozen' ? '已冻结' : ep.scriptStatus === 'draft' ? '已有草稿' : '待生成'}</span>
                        {ep.script && <span>· 已保存详细剧本 {ep.script.length.toLocaleString()} 字</span>}
                        {ep.characterAssetNotes && <span>· 已保存资产档案</span>}
                        <button
                          type="button"
                          onClick={() => generateEpisodeScript(ep.no)}
                          disabled={episodeBusy === ep.no}
                          className="ml-auto rounded-lg border border-[var(--canvas-accent)] px-2 py-1 text-[10px] text-[var(--canvas-accent)] disabled:opacity-50"
                        >
                          {episodeBusy === ep.no ? '生成中…' : ep.scriptStatus === 'draft' || ep.scriptStatus === 'frozen' ? '重写本集剧本' : '生成本集剧本'}
                        </button>
                      </div>
                      {ep.script && (
                        // In-flow disclosure: an absolutely positioned panel here
                        // was clipped by the table wrapper's overflow-hidden, so
                        // the content rendered but stayed invisible.
                        <details className="mt-2">
                          <summary className="inline-block cursor-pointer rounded-md border border-[var(--canvas-node-border)] px-2 py-1 text-[10px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]">查看完整剧本</summary>
                          <div className="mt-2 rounded-xl border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] p-3">
                            <div className="mb-2 text-[11px] font-medium text-[var(--canvas-text-1)]">第{ep.no}集完整剧本</div>
                            <textarea
                              value={ep.script}
                              onChange={(event) => {
                                const next = [...data.episodes]; next[i] = { ...ep, script: event.target.value, scriptStatus: 'draft' }; setEpisodes(next);
                              }}
                              className="min-h-64 w-full resize-y rounded-lg border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-[11px] leading-5 text-[var(--canvas-text-1)] outline-none focus:border-[var(--canvas-accent)]"
                            />
                          </div>
                        </details>
                      )}
                    </td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 角色档案 */}
      <section className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)]">角色档案</h3>
          <button
            onClick={() => upsertCharacters([{ id: `char-${Date.now().toString(36)}`, name: '新角色', personality: '', appearance: '' }])}
            className="flex items-center gap-1 text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            <Plus size={11} /> 加角色
          </button>
        </div>
        {data.characters.length === 0 ? (
          <p className="text-[11px] text-[var(--canvas-text-3)] py-3">（暂无，AI 拆解后自动填充）</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {data.characters.map((c) => (
              <div key={c.id} className={`${cardCls} group relative`} style={{ background: 'var(--canvas-node-bg)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <User size={13} className="text-[var(--canvas-text-2)] shrink-0" />
                  <input
                    className="bg-transparent text-[13px] font-medium text-[var(--canvas-text-1)] focus:outline-none flex-1 rounded transition-colors hover:bg-[rgba(255,255,255,0.04)] focus:bg-[rgba(255,255,255,0.04)] focus:shadow-[inset_0_-1px_0_0_var(--canvas-accent)]"
                    value={c.name}
                    onChange={(e) => patchChar(c.id, { name: e.target.value })}
                  />
                  <button
                    onClick={() => void handleRemoveCharacter(c.id)}
                    className="p-1.5 rounded opacity-0 group-hover:opacity-100 text-[var(--canvas-text-3)] hover:text-red-400 transition-all"
                    title="删除角色"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <label className="block text-[10px] text-[var(--canvas-text-3)] mb-0.5">性格</label>
                <SmartTextarea
                  rows={2}
                  value={c.personality}
                  onChange={(v) => patchChar(c.id, { personality: v })}
                  editorTitle={`性格 · ${c.name}`}
                />
                <label className="block text-[10px] text-[var(--canvas-text-3)] mt-2 mb-0.5">外形（生图用的具体描述）</label>
                <SmartTextarea
                  rows={3}
                  value={c.appearance}
                  onChange={(v) => patchChar(c.id, { appearance: v })}
                  editorTitle={`外形 · ${c.name}`}
                />
                {(c.lifecycleStages?.length ?? 0) > 0 && (
                  <div className="mt-2">
                    <label className="block text-[10px] text-[var(--canvas-text-3)] mb-1">生命周期形象</label>
                    {c.lifecycleStages!.map((st, i) => (
                      <p key={i} className="text-[10px] text-[var(--canvas-text-2)] leading-relaxed">
                        <span className="text-[var(--canvas-accent)]">{st.stage}</span>：{st.appearance}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
