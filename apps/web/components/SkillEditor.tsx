'use client';

import {useCallback, useEffect, useState} from 'react';
import {FileText, RefreshCw, Save, Sparkles} from 'lucide-react';
import {getSkill, listSkills, putSkill} from '../lib/api';
import type {SkillRead, SkillSummary} from '../lib/types';

const SKILL_LABEL: Record<string, string> = {
  panel_prompt: '画面生成 Prompt',
  speech_prompt: '配音 Prompt',
  video_prompt: '视频生成 Prompt',
  script_adaptation_prompt: '剧本改写 Prompt',
};

const SOURCE_LABEL = {disk: '已自定义', default: '默认'} as const;

type Props = {
  /** Optional callback after a skill is persisted. */
  onSaved?: (name: string) => void;
};

/**
 * M2.1 — Skill file editor.
 *
 * Lists the 4 known skills, lets the operator pick one and edit its Markdown
 * body, then persists via PUT /api/skills/{name}. Saving does not touch any
 * provider key. The loader hot-reloads on the backend, so the new prompt
 * applies to the next generation without a server restart.
 */
export function SkillEditor({onSaved}: Props) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const list = await listSkills();
      setSkills(list);
      if (list.length > 0 && selected === null) {
        setSelected(list[0].name);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载 skill 列表失败');
    } finally {
      setLoadingList(false);
    }
  }, [selected]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const loadDetail = useCallback(async (name: string) => {
    setLoadingDetail(true);
    setError('');
    try {
      const detail: SkillRead = await getSkill(name);
      setDraft(detail.body);
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载 skill 内容失败');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selected !== null) void loadDetail(selected);
  }, [selected, loadDetail]);

  const handleSave = async () => {
    if (selected === null || saving || !dirty) return;
    setSaving(true);
    setError('');
    try {
      const updated: SkillRead = await putSkill(selected, {body: draft});
      setDraft(updated.body);
      setDirty(false);
      setSavedAt(updated.updated_at ?? new Date().toISOString());
      onSaved?.(selected);
      // Refresh list so source/updated_at reflect the new state.
      void refreshList();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="skill-editor" aria-label="Skill 编辑器">
      <header className="skill-editor-header">
        <div>
          <h2>
            <Sparkles size={16} /> Skill Prompt 编辑器
          </h2>
          <p>编辑 Markdown prompt 模板，保存后立即生效（无需重启 API）。</p>
        </div>
        <button
          type="button"
          onClick={() => void refreshList()}
          disabled={loadingList}
          title="刷新列表"
          aria-label="刷新 skill 列表"
        >
          <RefreshCw size={14} className={loadingList ? 'spin' : ''} />
          刷新
        </button>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="skill-editor-body">
        <ul className="skill-list" role="tablist">
          {loadingList && skills.length === 0 ? (
            <li className="skill-list-loading">加载中…</li>
          ) : (
            skills.map(skill => (
              <li key={skill.name}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected === skill.name}
                  className={selected === skill.name ? 'skill-tab active' : 'skill-tab'}
                  onClick={() => setSelected(skill.name)}
                >
                  <FileText size={14} />
                  <span className="skill-tab-label">
                    {SKILL_LABEL[skill.name] ?? skill.name}
                  </span>
                  <span className={`skill-source skill-source-${skill.source}`}>
                    {SOURCE_LABEL[skill.source]}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="skill-detail">
          {selected === null ? (
            <p className="skill-empty">选择一个 skill 开始编辑。</p>
          ) : loadingDetail ? (
            <p className="skill-empty">加载中…</p>
          ) : (
            <>
              <div className="skill-detail-toolbar">
                <span className="skill-detail-name">
                  {SKILL_LABEL[selected] ?? selected}
                </span>
                <span className="skill-detail-hint">
                  支持 <code>{'{variable}'}</code> 占位符
                </span>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => void handleSave()}
                  disabled={!dirty || saving}
                  aria-busy={saving}
                >
                  <Save size={14} />
                  {saving ? '正在保存…' : '保存'}
                </button>
              </div>
              <textarea
                className="skill-textarea"
                value={draft}
                onChange={event => {
                  setDraft(event.target.value);
                  setDirty(true);
                }}
                spellCheck={false}
                aria-label={`编辑 ${selected} 模板`}
                rows={18}
              />
              <p className="skill-detail-status">
                {dirty
                  ? '有未保存的修改'
                  : savedAt
                  ? `已保存 · ${new Date(savedAt).toLocaleString()}`
                  : '已加载最新版本'}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
