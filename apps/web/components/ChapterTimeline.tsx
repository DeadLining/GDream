'use client';

import {useCallback, useEffect, useState} from 'react';
import {BookOpen, RefreshCw, Sparkles, ChevronDown, ChevronRight} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  extractChapterEvents,
  listChapters,
  reextractChapters,
} from '../lib/api/chapter';
import type {
  ChapterExtractionStatus,
  ChapterListResponse,
  ScriptChapter,
} from '../lib/types/chapter';

type Props = {
  scriptDocumentId: string;
  /** Optional callback when chapters change (e.g. to refresh downstream UI). */
  onChaptersChanged?: (chapters: ScriptChapter[]) => void;
  onExtractionComplete?: () => void | Promise<void>;
};

const STATUS_LABEL: Record<ChapterExtractionStatus, string> = {
  pending: '待提取',
  extracted: '已提取',
  failed: '提取失败',
  skipped: '已跳过',
};

const STATUS_CLASS: Record<ChapterExtractionStatus, string> = {
  pending: 'chapter-badge-pending',
  extracted: 'chapter-badge-extracted',
  failed: 'chapter-badge-failed',
  skipped: 'chapter-badge-skipped',
};

export function ChapterTimeline({scriptDocumentId, onChaptersChanged, onExtractionComplete}: Props) {
  const [chapters, setChapters] = useState<ScriptChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'reextract' | 'extract' | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refresh = useCallback(
    async (documentId: string) => {
      setLoading(true);
      setError('');
      try {
        const response: ChapterListResponse = await listChapters(documentId);
        setChapters(response.chapters);
        onChaptersChanged?.(response.chapters);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '加载章节失败');
      } finally {
        setLoading(false);
      }
    },
    [onChaptersChanged],
  );

  useEffect(() => {
    void refresh(scriptDocumentId);
  }, [scriptDocumentId, refresh]);

  const toggle = (id: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleReextract = async () => {
    setBusy('reextract');
    setError('');
    try {
      const response = await reextractChapters(scriptDocumentId);
      setChapters(response.chapters);
      onChaptersChanged?.(response.chapters);
      setExpanded(new Set());
      await onExtractionComplete?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重新切分失败');
    } finally {
      setBusy(null);
    }
  };

  const handleExtract = async () => {
    setBusy('extract');
    setError('');
    try {
      const response = await extractChapterEvents(scriptDocumentId);
      // Merge: refresh full list to reflect status changes on all rows.
      await refresh(scriptDocumentId);
      await onExtractionComplete?.();
      if (response.failed.length > 0) {
        setError(`${response.failed.length} 章提取失败，可单独重试`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '事件提取失败');
    } finally {
      setBusy(null);
    }
  };

  const handleExtractOne = async (chapterId: string) => {
    setError('');
    try {
      await extractChapterEvents(scriptDocumentId, {chapter_ids: [chapterId]});
      await refresh(scriptDocumentId);
      await onExtractionComplete?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '事件提取失败');
    }
  };

  const pendingCount = chapters.filter(c => c.extraction_status !== 'extracted').length;

  if (loading) {
    return (
      <section className="chapter-timeline">
        <div className="center-state">
          <p>正在加载章节…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="chapter-timeline">
      <header className="chapter-timeline-header">
        <div>
          <h2>
            <BookOpen size={16} /> 章节事件图谱
          </h2>
          <p>
            共 {chapters.length} 章 · {pendingCount} 章待提取
          </p>
        </div>
        <div className="chapter-timeline-actions">
          <button
            type="button"
            onClick={() => void handleReextract()}
            disabled={busy !== null}
            title="按当前正文重新切分章节"
          >
            <RefreshCw size={14} className={busy === 'reextract' ? 'spin' : ''} />
            重新切分
          </button>
          <button
            type="button"
            onClick={() => void handleExtract()}
            disabled={busy !== null || pendingCount === 0}
            title="用 AI 提取未完成章节的事件摘要"
          >
            <Sparkles size={14} className={busy === 'extract' ? 'spin' : ''} />
            提取全部事件
          </button>
        </div>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}

      {chapters.length === 0 ? (
        <div className="center-state">
          <p>该剧本暂无章节。保存正文后点击“重新切分”生成。</p>
        </div>
      ) : (
        <ul className="chapter-list">
          {chapters.map(chapter => {
            const isOpen = expanded.has(chapter.id);
            const summary = chapter.event_summary ?? {};
            const beats = summary.beats ?? [];
            return (
              <li key={chapter.id} className="chapter-item">
                <button
                  type="button"
                  className="chapter-row"
                  onClick={() => toggle(chapter.id)}
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="chapter-index">第 {chapter.chapter_index + 1} 章</span>
                  <span className="chapter-title">{chapter.title || '未命名'}</span>
                  <span className={`chapter-badge ${STATUS_CLASS[chapter.extraction_status]}`}>
                    {STATUS_LABEL[chapter.extraction_status]}
                  </span>
                  <span className="chapter-length">{chapter.source_text.length} 字</span>
                </button>
                {isOpen && (
                  <div className="chapter-detail">
                    {chapter.extraction_error && (
                      <p className="form-error">{chapter.extraction_error}</p>
                    )}
                    {beats.length > 0 ? (
                      <ol className="chapter-beats">
                        {beats.map(beat => (
                          <li key={beat.order}>
                            <strong>{beat.order}.</strong> {beat.summary}
                            {beat.characters.length > 0 && (
                              <em> · {beat.characters.join('、')}</em>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="chapter-empty">该章节尚未提取事件。</p>
                    )}
                    {summary.conflicts && summary.conflicts.length > 0 && (
                      <p className="chapter-meta">
                        <strong>冲突：</strong>
                        {summary.conflicts.join('；')}
                      </p>
                    )}
                    {summary.open_threads && summary.open_threads.length > 0 && (
                      <p className="chapter-meta">
                        <strong>伏笔：</strong>
                        {summary.open_threads.join('；')}
                      </p>
                    )}
                    <div className="chapter-source">
                      <details>
                        <summary>查看原文片段</summary>
                        <article className="chapter-source-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {chapter.source_text.slice(0, 800) + (chapter.source_text.length > 800 ? '…' : '')}
                          </ReactMarkdown>
                        </article>
                      </details>
                    </div>
                    {chapter.extraction_status !== 'extracted' && (
                      <button
                        type="button"
                        className="chapter-extract-one"
                        onClick={() => void handleExtractOne(chapter.id)}
                      >
                        <Sparkles size={12} /> 提取本章事件
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
