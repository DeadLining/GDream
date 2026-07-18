'use client';

import type {Project,ProjectDeletionPreview} from '../lib/types';

export function DeleteProjectDialog({project,preview,busy,error,warnings,onCancel,onConfirm}:{
  project:Project|null;
  preview:ProjectDeletionPreview|null;
  busy:boolean;
  error:string;
  warnings:string[];
  onCancel:()=>void;
  onConfirm:()=>void;
}){
  if(!project)return null;
  return <div className="dialog-backdrop"><section className="form-dialog delete-episode-dialog" role="dialog" aria-modal="true" aria-label="永久删除作品">
    <header><div><h2>永久删除作品</h2><p>{project.title}</p></div><button type="button" aria-label="关闭" disabled={busy} onClick={onCancel}>×</button></header>
    <p className="delete-episode-copy">此操作不可恢复，将同时删除作品的制作数据、交付归档和本地媒体文件。</p>
    {preview?<div className="delete-impact" aria-label="删除影响"><span>{preview.deleted.episodes} 个剧集</span><span>{preview.deleted.characters} 个角色</span><span>{preview.deleted.assets} 个媒体素材</span></div>:!error&&warnings.length===0&&<p className="delete-preview-loading">正在统计删除内容…</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {warnings.length>0&&<p className="cleanup-warning" role="status">作品已删除，但有 {warnings.length} 项本地文件未能清理。</p>}
    <footer>{warnings.length>0?<button type="button" aria-label="关闭清理提示" onClick={onCancel}>关闭</button>:<><button type="button" disabled={busy} onClick={onCancel}>取消</button><button type="button" className="danger-action" disabled={busy||!preview} onClick={onConfirm}>{busy?'正在删除…':'永久删除'}</button></>}</footer>
  </section></div>;
}
