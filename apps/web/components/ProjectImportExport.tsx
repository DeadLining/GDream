'use client';

import {useRef, useState} from 'react';
import {Download, Loader2, Upload, AlertTriangle, CheckCircle2} from 'lucide-react';
import {exportProject, importProject, projectExportDownloadUrl} from '../lib/api';
import type {ProjectImportResponse} from '../lib/types';

type Props = {
  projectId: string;
  /** Called after a successful import so the parent can refresh its project list. */
  onImported?: (result: ProjectImportResponse) => void;
};

/**
 * M2.3 — Project ZIP import / export control.
 *
 * Renders two actions:
 * - Export: triggers server-side ZIP creation and surfaces the returned path.
 * - Import: lets the operator pick a ZIP, uploads it, and reports the new
 *   project id plus any schema/revision warnings.
 *
 * Designed to drop into ProjectSettings as a standalone section.
 */
export function ProjectImportExport({projectId, onImported}: Props) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [exportInfo, setExportInfo] = useState<{bytes: number} | null>(null);
  const [importInfo, setImportInfo] = useState<ProjectImportResponse | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setError('');
    setExportInfo(null);
    try {
      const result = await exportProject(projectId);
      setExportInfo({bytes: result.bytes_written});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (file: File | null) => {
    if (!file || importing) return;
    setImporting(true);
    setError('');
    setImportInfo(null);
    try {
      const result = await importProject(file);
      setImportInfo(result);
      onImported?.(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入失败');
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <section className="project-portability" aria-label="工程导入导出">
      <header>
        <h2>工程 ZIP 导入 / 导出</h2>
        <p>导出当前作品（含角色、剧集、场景、镜头、对白与资产）为可移植 ZIP；也可从 ZIP 导入为新作品。</p>
      </header>

      <div className="portability-actions">
        <div className="portability-card">
          <div className="portability-card-head">
            <Download size={18} />
            <strong>导出当前作品</strong>
          </div>
          <p className="portability-card-hint">
            生成 ZIP 包含 manifest.json、database.json 与 assets/ 资源。
          </p>
          <button
            type="button"
            className="primary-action"
            onClick={() => void handleExport()}
            disabled={exporting}
            aria-busy={exporting}
          >
            {exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
            {exporting ? '正在打包…' : '导出 ZIP'}
          </button>
          {exportInfo && <>
            <p className="portability-success" role="status">
              <CheckCircle2 size={12} />
              已生成 {formatBytes(exportInfo.bytes)}
            </p>
            <a
              className="command-button"
              aria-label="下载工程 ZIP"
              href={projectExportDownloadUrl(projectId)}
              download
            >
              <Download size={14}/>
              下载工程 ZIP
            </a>
          </>}
        </div>

        <div className="portability-card">
          <div className="portability-card-head">
            <Upload size={18} />
            <strong>从 ZIP 导入</strong>
          </div>
          <p className="portability-card-hint">
            选择 .zip 文件，系统会以新作品 ID 导入（保留全部结构）。
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            aria-label="选择 ZIP 工程包"
            onChange={event => void handleImportFile(event.target.files?.[0] ?? null)}
            disabled={importing}
          />
          {importInfo && (
            <p className="portability-success" role="status">
              <CheckCircle2 size={12} />
              已导入为新作品 · {importInfo.project_id.slice(0, 8)}…
              {importInfo.warnings.length > 0 && (
                <span className="portability-warnings">
                  （{importInfo.warnings.length} 条警告）
                </span>
              )}
            </p>
          )}
          {importInfo && importInfo.warnings.length > 0 && (
            <ul className="portability-warning-list" role="alert">
              {importInfo.warnings.map((w, i) => (
                <li key={i}>
                  <AlertTriangle size={11} /> {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
