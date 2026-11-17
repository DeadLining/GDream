import { useState, type ReactNode } from 'react';
import { Activity, Check, ChevronDown, Clock3, Film, Layers3, MessageSquare, ShieldCheck, Terminal, AlertTriangle } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { WORKSHOP_STEPS, type WorkshopStepId } from '@/lib/workshop/types';
import { useRunStepStore, type RunStep, type RunToolCall } from '@/stores/runStepStore';
import { evidencedStepStatus } from '@/lib/chat/runPresentation';
import { isTechnicalProgressText, formatToolBatchLabel, formatToolSummary } from '@/lib/agent/toolSummary';
import './chatPresentation.css';

const statusText = {
  pending: '待核实', active: '执行中', done: '回执成功', failed: '失败', skipped: '未完成',
};

function DisclosureChevron() {
  return <ChevronDown size={13} className="chat-disclosure-chevron" aria-hidden="true" />;
}

function toolParams(params: unknown): Record<string, unknown> {
  return params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, unknown> : {};
}

function ToolReceipt({ tool }: { tool: RunToolCall }) {
  const status = tool.status === 'done' ? '工具已返回成功'
    : tool.status === 'failed' ? '失败' : tool.status === 'interrupted' ? '已中断' : '执行中';
  return <div className="chat-tool-receipt">
    <div className="chat-muted chat-tool-caption">{tool.name.startsWith('workshop_') ? formatToolSummary(tool.name, toolParams(tool.params)) : tool.summary}<span aria-hidden="true"> · </span>{status}</div>
    {tool.error && <div role="note" className="chat-warning chat-preserve-text">阻塞原因：{tool.error}</div>}
    {tool.output && !isTechnicalProgressText(tool.output) && <details className="chat-disclosure" data-reading-control>
      <summary><DisclosureChevron />完整回执与检查结论</summary>
      <div className="chat-disclosure-body chat-preserve-text">{tool.output}</div>
    </details>}
    <details className="chat-disclosure chat-technical" data-reading-control>
      <summary><Terminal size={12} aria-hidden="true" />技术日志<DisclosureChevron /></summary>
      <div className="chat-log-body">
        <div className="chat-muted">{tool.name}</div>
        <pre>{JSON.stringify(tool.params, null, 2)}</pre>
        <pre>{tool.output ?? tool.resultSummary}</pre>
      </div>
    </details>
  </div>;
}

const WORKSHOP_STAGE_LABELS: Record<WorkshopStepId, string> = {
  script: '剧本',
  breakdown: '拆解',
  assets: '资产',
  prompts: '提示词',
  generate: '生成',
  handoff: '交付',
};

function WorkshopStageJump() {
  const currentStep = useWorkshopStore((state) => state.data?.currentStep);
  const setCurrentStep = useWorkshopStore((state) => state.setCurrentStep);
  const steps = useWorkshopStore((state) => state.data?.steps);
  if (!currentStep || !steps) return null;

  return (
    <nav className="chat-stage-jump" aria-label="工坊阶段" data-reading-control>
      {WORKSHOP_STEPS.map((stage, index) => {
        const status = steps[stage.id]?.status;
        const active = currentStep === stage.id;
        return (
          <button
            key={stage.id}
            type="button"
            className="chat-stage-jump-item"
            data-active={active}
            data-status={status}
            onClick={() => setCurrentStep(stage.id)}
            title={`${stage.label}：${stage.hint}`}
          >
            <span className="chat-stage-jump-index">{status === 'done' ? '✓' : index + 1}</span>
            <span>{WORKSHOP_STAGE_LABELS[stage.id]}</span>
          </button>
        );
      })}
    </nav>
  );
}

function Step({ step, number }: { step: RunStep; number: number }) {
  const status = evidencedStepStatus(step);
  return <details className="chat-step" data-status={status} data-reading-control data-testid="production-step">
    <summary>
      <span className="chat-step-marker" aria-hidden="true">
        {status === 'done' ? <Check size={12} /> : String(number).padStart(2, '0')}
      </span>
      <span className="chat-step-heading">
        <span className="chat-step-title">{step.title === '更新工坊内容' && step.toolCalls.length ? formatToolBatchLabel(step.toolCalls.map(tool => ({ name: tool.name, params: toolParams(tool.params) }))) : step.title}</span>
        <span className="chat-step-meta">{step.startedAt ? new Date(step.startedAt).toLocaleTimeString() : '计划步骤'} · 说明与回执</span>
      </span>
      <span className="chat-status" data-status={status}>{statusText[status]}</span>
      <DisclosureChevron />
    </summary>
    <div className="chat-step-body">
      {step.detail && <p className="chat-preserve-text">{step.detail}</p>}
      {step.toolCalls.map((tool) => <ToolReceipt key={tool.id} tool={tool} />)}
      {step.subAgents.map((sub) => <div key={sub.id} className="chat-tool-receipt chat-preserve-text">
        <div>{sub.title} · {sub.status === 'completed' ? '已完成' : sub.status === 'failed' ? '失败' : '执行中'}</div>
        <p>{sub.error || sub.outputSummary}</p>
      </div>)}
    </div>
  </details>;
}

export default function RunStepTimeline({ runId, compact = false, showHeader = true, className = '', tone = 'default', children }: {
  children?: ReactNode; runId?: string; compact?: boolean; showHeader?: boolean; className?: string; tone?: 'default' | 'dark' | 'light';
}) {
  const sessionId = useChatStore((s) => s.currentSessionId);
  const run = useRunStepStore((s) => s.runsById[runId ?? (sessionId ? s.runIdsBySession[sessionId]?.[0] : '')] ?? null);
  const [open, setOpen] = useState(run.status === 'running');
  if (!run) return null;
  const steps = [...run.steps].sort((a, b) => (a.startedAt ?? run.startedAt) - (b.startedAt ?? run.startedAt));
  const failed = steps.flatMap((s) => s.toolCalls).filter((t) => t.status === 'failed');
  const businessUpdates = (run.progressUpdates ?? []).filter((p) => !isTechnicalProgressText(p.text));
  const outcomes = run.outcomes ?? [];
  const runLabel = run.status === 'running' ? '进行中' : run.status === 'done' ? '本轮已结束' : run.status === 'failed' ? '执行失败' : '已中断';
  return <section data-testid="run-history" data-tone={tone} className={`chat-run ${compact ? 'chat-run-compact' : ''} ${className}`}>
    <button type="button" className="chat-run-heading" data-reading-control aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="chat-run-icon"><Activity size={16} aria-hidden="true" /></span>
      <span className="chat-run-heading-copy">
        <span className="chat-run-title">{showHeader ? '制作过程' : '制作记录'}</span>
        <span className="chat-muted">{steps.length} 个步骤{outcomes.length > 0 ? ` · ${outcomes.length} 项成果` : ''}</span>
      </span>
      <span className="chat-run-state" data-running={run.status === 'running'}>{runLabel}</span>
      <ChevronDown size={14} className={`chat-run-chevron ${open ? 'is-open' : ''}`} aria-hidden="true" />
    </button>
    {children && <div className="chat-live-decision">{children}</div>}
    {open && <div className="chat-run-content">
      <WorkshopStageJump />
      {failed.length > 0 && <div className="chat-warning">
        <div className="chat-warning-heading"><AlertTriangle size={14} aria-hidden="true" />阻塞与失败记录</div>
        {failed.map((t) => <details key={t.id} className="chat-disclosure" data-reading-control>
          <summary><DisclosureChevron />{t.summary}</summary>
          <p className="chat-preserve-text">{t.error ?? t.resultSummary}</p>
        </details>)}
      </div>}
      {run.decisions?.filter((d) => !children || d.status !== 'pending').map((d) => <details key={d.id}
        className="chat-decision" data-pending={d.status === 'pending'} open={d.status === 'pending'} data-reading-control>
        <summary>
          <ShieldCheck size={14} aria-hidden="true" /><span>{d.title}</span>
          <span className="chat-decision-state">{d.status === 'pending' ? (run.status === 'running' ? '待确认' : '未完成确认') : d.status === 'answered' ? '已记录' : d.status === 'cancelled' ? '已取消' : '已中断'}</span>
          <DisclosureChevron />
        </summary>
        <div className="chat-disclosure-body">
          {d.questions.map((q, i) => <div key={i} className="chat-decision-question">
            <p className="chat-preserve-text">{q}</p>
            {d.answers?.[i] && <p className="chat-decision-answer chat-preserve-text"><Check size={12} aria-hidden="true" />{d.answers[i]}</p>}
          </div>)}
          <p className="chat-footnote">历史记录仅供回看，不会恢复授权或重新提交任务。</p>
        </div>
      </details>)}
      <div className="chat-section-caption"><span>执行步骤</span><span>状态依据实际回执</span></div>
      <div className="chat-step-list">{steps.map((step, index) => <Step key={step.id} step={step} number={index + 1} />)}</div>
      {businessUpdates.length > 0 && <details className="chat-disclosure chat-progress-notes" data-reading-control>
        <summary><MessageSquare size={13} aria-hidden="true" />过程说明<span className="chat-count">{businessUpdates.length}</span><DisclosureChevron /></summary>
        <div className="chat-disclosure-body">
          <p className="chat-footnote">以下说明不作为完成凭据。</p>
          {businessUpdates.map((p) => <div key={p.id} className="chat-progress-note chat-preserve-text">
            <time>{new Date(p.createdAt).toLocaleTimeString()}</time>{p.text}
          </div>)}
        </div>
      </details>}
      {outcomes.map((outcome) => <section key={outcome.id} className="chat-outcome" data-testid="saved-outcome">
        <div className="chat-outcome-heading"><Layers3 size={14} aria-hidden="true" /><h4>阶段成果</h4>
          {outcome.shots.length > 0 && <span className="chat-count">{outcome.shots.length} 个分镜</span>}
        </div>
        <p className="chat-outcome-title">{outcome.title}</p>
        <p className="chat-footnote">{outcome.summary}</p>
        {outcome.receipt && <details className="chat-disclosure" data-reading-control>
          <summary><DisclosureChevron />查看成果与检查结论</summary><p className="chat-disclosure-body chat-preserve-text">{outcome.receipt}</p>
        </details>}
        {outcome.shots.length > 0 && <div className="chat-section-caption"><span>分镜列表</span><span>已保存的方案快照</span></div>}
        <div className="chat-shot-list">{outcome.shots.map((shot) => <details key={shot.shotNo} className="chat-shot" data-reading-control>
          <summary>
            <span className="chat-shot-heading"><Film size={13} aria-hidden="true" /><span>{shot.shotNo}</span></span>
            <span className="chat-shot-preview">{shot.description || '画面待补充'}</span>
            <span className="chat-shot-meta"><span><Clock3 size={11} aria-hidden="true" />{shot.durationSec ? `${shot.durationSec} 秒` : '时长待定'}</span></span><DisclosureChevron />
          </summary>
          <dl className="chat-shot-details">
            <dt>画面</dt><dd>{shot.description}</dd>
            <dt>运镜</dt><dd>{shot.camera || '运镜待定'}</dd>
            <dt>字幕 / 旁白 / 对白</dt><dd>{shot.dialogue || '未登记'}</dd>
            <dt>对应素材</dt><dd className="chat-materials">{shot.materials.length ? shot.materials.map((material, index) => <span key={`${material}-${index}`}>{material}</span>) : '未绑定'}</dd>
            {(shot.imagePath || shot.videoPath) && <><dt>已有产物路径</dt><dd>{[shot.imagePath, shot.videoPath].filter(Boolean).join('\n')}</dd></>}
          </dl>
        </details>)}</div>
      </section>)}
    </div>}
  </section>;
}
