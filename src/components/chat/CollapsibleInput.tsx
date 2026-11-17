import { useLayoutEffect, useRef, useState } from 'react';
import { presentInput } from '@/lib/chat/inputPresentation';
import { Check, ChevronDown, Copy, FileText, ListChecks } from 'lucide-react';
import './chatPresentation.css';
import { writeText } from '@tauri-apps/api/clipboard';

export default function CollapsibleInput({ content, fullText }: { content: string; fullText?: string }) {
  const view = presentInput(fullText ?? content);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const measure = () => setOverflow(element.scrollHeight > 80);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [view.userText, view.generated]);
  const toggle = () => {
    const button = buttonRef.current, scroll = button?.closest<HTMLElement>('[data-chat-scroll]');
    const top = button?.getBoundingClientRect().top;
    setExpanded((value) => !value);
    requestAnimationFrame(() => {
      if (button && scroll && top !== undefined) scroll.scrollTop += button.getBoundingClientRect().top - top;
    });
  };
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(view.fullText);
      else await writeText(view.fullText);
      setCopied(true); setCopyError(false);
    } catch { setCopyError(true); }
  };
  return <div className="chat-input min-w-0" data-testid="collapsible-input">
    <div className="chat-input-label">{view.generated ? <ListChecks size={12} aria-hidden="true" /> : <FileText size={12} aria-hidden="true" />}{view.generated ? '自动任务' : '原始要求'}{view.generated && <span>摘要</span>}</div>
    <div ref={textRef} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]" style={expanded ? undefined : {
      maxHeight: '5rem', overflow: 'hidden', lineHeight: '1.25rem',
      maskImage: overflow ? 'linear-gradient(black 65%, transparent)' : undefined,
    }}>{!expanded && view.generated ? view.summary : view.userText}</div>
    <div className="chat-input-actions" data-reading-control>
      {(view.generated || overflow || expanded) && <button ref={buttonRef} type="button" aria-expanded={expanded} onClick={toggle}>{expanded ? '收起' : '展开全文'}<ChevronDown size={12} className={expanded ? 'rotate-180' : ''} aria-hidden="true" /></button>}
      <button type="button" onClick={() => void copy()}>{copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}{copied ? '已复制全文' : '复制完整内容'}</button>
      {copyError && <span role="alert">复制失败，请重试</span>}
    </div>
    {view.context && <details className="chat-context" data-reading-control>
      <summary>系统上下文与执行规则<ChevronDown size={12} className="chat-disclosure-chevron" aria-hidden="true" /></summary>
      <pre className="mt-1 whitespace-pre-wrap break-words">{view.context}</pre>
    </details>}
  </div>;
}
