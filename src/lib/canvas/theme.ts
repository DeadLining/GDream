/**
 * Canvas dark-theme color constants for JS-side consumers (MiniMap props,
 * NodeResizer color, SVG attrs that can't read CSS vars at render time).
 *
 * ⚠️ MUST stay in sync with the `.canvas-dark` variable block in
 * src/index.css — values are aligned with the Codex app design tokens
 * (--gray-*, --blue-400, semi-transparent white borders).
 */
export const CANVAS_THEME = {
  bg: '#0d0d0d',
  bgDot: '#262626',
  nodeBg: '#1c1c1c',
  nodeBorder: 'rgba(255,255,255,0.08)',
  nodeBorderSelected: 'rgba(255,255,255,0.24)',
  handle: '#5d5d5d',
  edge: '#5d5d5d',
  edgeHover: '#afafaf',
  edgeSelected: '#ededed',
  panel: '#181818',
  panelElevated: '#212121',
  text1: '#ffffff',
  text2: '#afafaf',
  text3: '#5d5d5d',
  accent: '#0285ff',
  success: '#04b84c',
  danger: '#ff6163',
  minimapBg: 'rgba(24, 24, 24, 0.9)',
  minimapNode: '#5d5d5d',
  minimapMask: 'rgba(255, 255, 255, 0.06)',
  minimapMaskStroke: 'rgba(255, 255, 255, 0.35)',
} as const;
