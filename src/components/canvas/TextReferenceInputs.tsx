import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { FileText, X } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { projectTextInputs } from '@/lib/canvas/textFlow';

/** Read-only views: opening/copying never writes the draft or submits a generation. */
export default function TextReferenceInputs({nodeId, ownPrompt, formatPrompt, previewLabel = '最终提交提示词'}: {
  nodeId: string; ownPrompt: string; formatPrompt?: (prompt: string) => string; previewLabel?: string;
}) {
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const opener = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const projection = projectTextInputs(nodeId, ownPrompt, nodes, edges);
  const reference = projection.references.find(r => r.nodeId === view);
  const isFinal = view === '__final__';
  const content = isFinal ? (formatPrompt?.(projection.prompt) ?? projection.prompt) : reference?.content ?? '';
  const close = () => { setView(null); setCopyStatus(''); opener.current?.focus({preventScroll:true}); };
  const open = (id: string) => { opener.current = document.activeElement as HTMLElement; setView(id); setCopyStatus(''); };
  return <>
    <div className="nodrag nopan nowheel flex items-center gap-2 px-3 pt-2 pb-1 text-[10px] text-[var(--canvas-text-2)]">
      <span className="shrink-0">文本引用</span>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto canvas-asset-scrollbar">
        {projection.references.map((ref, index) => <button type="button" key={ref.nodeId} onClick={() => open(ref.nodeId)} title={`${ref.label} · 点击查看全文`}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--canvas-node-border)] px-2 py-1 hover:bg-white/5">
          <FileText size={12}/><span className="max-w-[140px] truncate">文本{index + 1} · {ref.label}</span>
          <span className="opacity-60">{ref.status === 'included' ? '已引用' : ref.status === 'duplicate' ? '已去重' : '空内容'}</span>
        </button>)}
        {!projection.references.length && <span className="py-1 opacity-50">未连接文本节点</span>}
      </div>
      <button type="button" onClick={() => open('__final__')} className="shrink-0 rounded-lg px-2 py-1 hover:bg-white/5">{previewLabel}</button>
    </div>
    {view && createPortal(<div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-8" onClick={close} onKeyDown={e => {e.stopPropagation(); if(e.key === 'Escape') close();}}>
      <section role="dialog" aria-modal="true" aria-label={isFinal ? previewLabel : reference?.label || '文本引用'} className="flex max-h-[80vh] w-[760px] max-w-full flex-col rounded-2xl border border-white/10 bg-[#252525] p-5 text-neutral-200 shadow-2xl" onClick={e=>e.stopPropagation()} onKeyDown={e => {
        if (e.key !== 'Tab') return;
        const targets = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'));
        const first = targets[0], last = targets[targets.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }}>
        <header className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{isFinal ? previewLabel : reference?.label || '引用已断开'}</h3><button type="button" autoFocus aria-label="关闭文本预览" onClick={close}><X size={18}/></button></header>
        <p className="my-3 text-xs text-neutral-400">{isFinal ? '生成流程将使用的提示词正文（含文本引用及当前风格）。不含独立提交的媒体和模型参数。' : `来源节点：${reference?.nodeId ?? '已移除'} · ${reference?.status === 'duplicate' ? '与输入框或其他引用相同，提交时仅保留一份。' : '实时读取上游文本，不复制到输入框。'}`}</p>
        <pre tabIndex={0} className="nowheel nodrag nopan min-h-24 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-xl bg-black/20 p-4 text-xs leading-6 select-text" onWheel={e=>e.stopPropagation()}>{content || '暂无文本内容'}</pre>
        <footer className="mt-3 flex items-center justify-between text-xs text-neutral-400"><span>{content.length} 字 · {copyStatus}</span><button type="button" disabled={!content} className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-40" onClick={async()=>{try {if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(content);
        } else {
          const area = document.createElement('textarea');
          area.value = content; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area);
          try { area.select(); if (!document.execCommand('copy')) throw new Error('Copy unavailable'); }
          finally { area.remove(); }
        }setCopyStatus('已复制全文');} catch {setCopyStatus('复制失败，请选择正文复制');}}}>复制全文</button></footer>
      </section>
    </div>,document.body)}
  </>;
}
