import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Palette } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { loadStyleLibrary, type StylePreset, type StyleCategory } from '@/lib/styleLibrary';
import { loadMidjourneyStyleLibrary, type MidjourneyStylePreset } from '@/lib/midjourney/styles';

/** Bundled web assets (public/) are used as-is; local files go through the asset protocol. */
function styleThumbSrc(path: string): string {
  if (/^\/(Users|home|var|private|tmp)\//.test(path) || /^[A-Za-z]:[\\/]/.test(path)) {
    return convertFileSrc(path);
  }
  return path;
}

export default function StyleLibraryPicker({
  open,
  onClose,
  onApply,
  onClear,
  library = 'general',
}: {
  open: boolean;
  onClose: () => void;
  onApply: (style: StylePreset) => void;
  onClear: () => void;
  library?: 'general' | 'midjourney';
}) {
  const [categories, setCategories] = useState<StyleCategory[]>([]);
  const [styles, setStyles] = useState<StylePreset[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    bottom: number;
    left: number;
    width: number;
    placement: 'up' | 'down';
    available: number;
    gridMaxHeight: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const loader = library === 'midjourney' ? loadMidjourneyStyleLibrary : loadStyleLibrary;
    loader().then((data) => {
      setCategories(data.categories);
      setStyles(data.styles);
      setActiveCategory('all');
      setSelected(null);
    });
  }, [open, library]);

  useEffect(() => {
    if (!open || !anchorRef.current) { setPos(null); return; }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 8;
      const panelWidth = Math.min(
        Math.max(rect.width, 520),
        Math.max(280, window.innerWidth - viewportPadding * 2),
      );
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding),
      );
      const spaceAbove = Math.max(0, rect.top - viewportPadding - gap);
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding - gap);
      // 底部工具条仍优先向上；当上方空间不足时，资产页这类入口会改为向下展开。
      const placement: 'up' | 'down' = spaceAbove >= 440 || spaceAbove >= spaceBelow ? 'up' : 'down';
      const available = placement === 'up' ? spaceAbove : spaceBelow;
      setPos({
        top: rect.top,
        bottom: rect.bottom,
        left,
        width: panelWidth,
        placement,
        available,
        gridMaxHeight: Math.max(120, Math.min(360, available - 86)),
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const filtered = useMemo(() => {
    let list = styles;
    if (activeCategory !== 'all') {
      list = list.filter((s) => s.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s) => [s.name, s.visualDNA, s.cameraLanguage]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)));
    }
    return list;
  }, [styles, activeCategory, search]);

  const handleApply = () => {
    const style = styles.find((s) => s.id === selected);
    if (style) {
      onApply(style);
      onClose();
    }
  };

  const panel = (
    <AnimatePresence>
      {open && pos && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.15 }}
          className="canvas-dark fixed z-[9999] flex flex-col overflow-hidden rounded-xl"
          style={{
            ...(pos.placement === 'up'
              ? { bottom: `${window.innerHeight - pos.top + 8}px` }
              : { top: `${pos.bottom + 8}px` }),
            left: `${pos.left}px`,
            width: `${pos.width}px`,
            maxHeight: `${Math.max(180, pos.available)}px`,
            background: 'var(--canvas-panel, #262626)',
            border: '1px solid var(--canvas-node-border, rgba(255,255,255,0.08))',
            boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between px-3 py-2 border-b border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-1.5">
              <Palette size={14} className="text-[var(--canvas-accent)]" />
              <span className="text-[12px] font-medium text-[var(--canvas-text-1)]">
                {library === 'midjourney' ? 'Midjourney 风格库' : '风格库'}
              </span>
              <div className="flex gap-0.5 ml-2 max-w-[420px] overflow-x-auto no-scrollbar">
                <button
                  onClick={() => setActiveCategory('all')}
                  className={`px-2.5 py-0.5 rounded-md text-[11px] transition-colors ${
                    activeCategory === 'all'
                      ? 'bg-[rgba(255,255,255,0.1)] text-[var(--canvas-text-1)] font-medium'
                      : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
                  }`}
                >
                  全部
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveCategory(c.id)}
                    className={`px-2.5 py-0.5 rounded-md text-[11px] transition-colors ${
                      activeCategory === c.id
                        ? 'bg-[rgba(255,255,255,0.1)] text-[var(--canvas-text-1)] font-medium'
                        : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[rgba(255,255,255,0.05)]">
                <Search size={11} className="text-[var(--canvas-text-3)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索风格..."
                  className="bg-transparent text-[11px] text-[var(--canvas-text-2)] w-24 outline-none placeholder:text-[var(--canvas-text-4)]"
                />
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)]"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Grid */}
          <div key={activeCategory} className="min-h-0 overflow-y-auto p-2.5" style={{ maxHeight: pos.gridMaxHeight }}>
            <div className="grid grid-cols-4 gap-2.5">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(selected === s.id ? null : s.id)}
                  className={`group flex flex-col items-center rounded-lg border p-1.5 transition-colors ${
                    selected === s.id
                      ? 'border-[rgba(2,133,255,0.6)] bg-[rgba(2,133,255,0.1)]'
                      : 'border-[var(--canvas-node-border)] hover:border-[var(--canvas-node-border-selected)] hover:bg-[var(--canvas-controls-hover)]'
                  }`}
                >
                  <div className="w-full aspect-[4/3] rounded-md overflow-hidden bg-[rgba(0,0,0,0.2)]">
                    <img
                      // Two thumbnail kinds share this picker:
                      //  - bundled web assets from public/ (e.g. /midjourney-styles/x.jpg)
                      //    — root-relative web paths, used as-is;
                      //  - local files (style-library under ~/.gdream) — a raw
                      //    "/Users/..." src 404s against the webview origin, so
                      //    route those through the asset protocol.
                      src={styleThumbSrc(s.thumbnailPath)}
                      alt={s.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="mt-1 text-[10px] text-[var(--canvas-text-2)] text-center leading-tight line-clamp-2 w-full">
                    {s.name}
                  </span>
                  {library === 'midjourney' && (() => {
                    const mj = s as MidjourneyStylePreset;
                    return (
                      <span className="mt-0.5 flex items-center gap-1 text-[8px] text-[var(--canvas-text-4)]">
                        <span className={mj.calibration === 'api-tested' ? 'text-emerald-400/80' : 'text-amber-300/80'}>
                          {mj.calibration === 'api-tested' ? '实测' : '导演'}
                        </span>
                        <span>S{mj.stylize ?? 300} · C{mj.chaos ?? 0}{mj.raw ? ' · RAW' : ''}</span>
                      </span>
                    );
                  })()}
                </button>
              ))}
            </div>
            {filtered.length === 0 && (
              <div className="text-center text-[11px] text-[var(--canvas-text-3)] py-8">未找到匹配的风格</div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-between px-3 py-2 border-t border-[rgba(255,255,255,0.06)]">
            <span className="text-[10px] text-[var(--canvas-text-3)]">
              {filtered.length} 种{library === 'midjourney' ? ' Midjourney 专属' : ''}风格
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  setSelected(null);
                  onClear();
                }}
                className="px-2.5 py-1 rounded-lg text-[11px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:border-[var(--canvas-node-border-selected)]"
              >
                清除风格
              </button>
              <button
                onClick={handleApply}
                disabled={!selected}
                className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                  selected
                    ? 'bg-[var(--canvas-accent)] text-white hover:opacity-90'
                    : 'bg-[rgba(255,255,255,0.05)] text-[var(--canvas-text-4)] cursor-not-allowed'
                }`}
              >
                应用风格
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <div ref={anchorRef} className="absolute inset-0 pointer-events-none" />
      {createPortal(panel, document.body)}
    </>
  );
}
