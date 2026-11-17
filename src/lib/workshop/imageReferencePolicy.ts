export type ImageReferencePriorityKind =
  | 'start-frame'
  | 'previous-tail'
  | 'character'
  | 'scene'
  | 'prop'
  | 'extra'
  | 'palette'
  | 'other';

export interface ImageReferenceInput {
  path: string;
  label: string;
  kind: ImageReferencePriorityKind;
  /** 原始资产引用编号；运行时新增的首帧、上一镜尾帧没有该编号。 */
  sourceIndex?: number;
  required?: boolean;
  priority?: number;
}

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function parseImageIndex(value: string): number | undefined {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === '十') return 10;
  if (value.startsWith('十')) return 10 + (CN_DIGITS[value.slice(1)] ?? 0);
  if (value.includes('十')) {
    const [tens, units] = value.split('十');
    return (CN_DIGITS[tens] ?? 0) * 10 + (CN_DIGITS[units] ?? 0);
  }
  return CN_DIGITS[value];
}

function chineseIndex(value: number): string {
  if (value <= 9) return Object.entries(CN_DIGITS).find(([, number]) => number === value)?.[0] ?? String(value);
  if (value === 10) return '十';
  if (value < 20) return `十${chineseIndex(value - 10)}`;
  if (value < 100) return `${chineseIndex(Math.floor(value / 10))}十${value % 10 ? chineseIndex(value % 10) : ''}`;
  return String(value);
}

export function imageReferenceIndexMap(projection: ImageReferenceProjection): Map<number, number> {
  const map = new Map<number, number>();
  projection.selected.forEach((item, index) => {
    if (item.sourceIndex !== undefined) map.set(item.sourceIndex, index + 1);
  });
  return map;
}

export function remapImageReferenceMentions(text: string, indexMap: Map<number, number>): string {
  if (!text.trim()) return text;
  return text
    .replace(/@图片(\d+|[一二三四五六七八九十]+)/g, (_match, raw: string) => {
      const oldIndex = parseImageIndex(raw);
      const nextIndex = oldIndex === undefined ? undefined : indexMap.get(oldIndex);
      return nextIndex === undefined ? '' : `@图片${chineseIndex(nextIndex)}`;
    })
    .replace(/<Picture\s+(\d+)>/gi, (_match, raw: string) => {
      const nextIndex = indexMap.get(Number(raw));
      return nextIndex === undefined ? '' : `<Picture ${nextIndex}>`;
    })
    .replace(/[ \t]{2,}/g, ' ');
}

export interface ImageReferenceProjection {
  engineId: string;
  limit: number;
  requested: ImageReferenceInput[];
  selected: ImageReferenceInput[];
  omitted: ImageReferenceInput[];
  canSubmit: boolean;
  summary: string;
}

export function imageReferenceLimitForEngine(engineId: string): number {
  const normalized = engineId.trim().toLowerCase();
  if (normalized.includes('seedream-v5-pro') || normalized.includes('seedream-5')) return 10;
  if (normalized.includes('gpt-image-2')) return 10;
  if (normalized.includes('midjourney')) return 10;
  return Number.POSITIVE_INFINITY;
}

function defaultPriority(item: ImageReferenceInput): number {
  if (item.kind === 'start-frame') return 1000;
  if (item.kind === 'previous-tail') return 900;
  if (item.kind === 'character') return 800;
  if (item.kind === 'scene') return /角度\s*[2-9]|角度\s*\d{2,}/.test(item.label) ? 500 : 700;
  if (item.kind === 'prop') return 650;
  if (item.kind === 'extra') return 400;
  if (item.kind === 'palette') return 300;
  return 200;
}

export function projectImageReferencesForProvider(input: {
  engineId: string;
  references: ImageReferenceInput[];
}): ImageReferenceProjection {
  const requested = input.references.filter((item) => item.path.trim());
  const limit = imageReferenceLimitForEngine(input.engineId);
  if (!Number.isFinite(limit) || requested.length <= limit) {
    return {
      engineId: input.engineId,
      limit,
      requested,
      selected: requested,
      omitted: [],
      canSubmit: true,
      summary: `参考图全部提交，共 ${requested.length} 张`,
    };
  }

  const required = requested.filter((item) => item.required);
  if (required.length > limit) {
    return {
      engineId: input.engineId,
      limit,
      requested,
      selected: [],
      omitted: requested,
      canSubmit: false,
      summary: `必需参考图 ${required.length} 张，超过当前生图模型上限 ${limit} 张`,
    };
  }

  const indexed = requested.map((item, index) => ({ item, index }));
  const selectedIndexes = new Set(required.map((item) => requested.indexOf(item)));
  indexed
    .filter(({ index }) => !selectedIndexes.has(index))
    .sort((left, right) => {
      const priorityDelta = (right.item.priority ?? defaultPriority(right.item))
        - (left.item.priority ?? defaultPriority(left.item));
      return priorityDelta || left.index - right.index;
    })
    .slice(0, limit - required.length)
    .forEach(({ index }) => selectedIndexes.add(index));

  const selected = indexed.filter(({ index }) => selectedIndexes.has(index)).map(({ item }) => item);
  const omitted = indexed.filter(({ index }) => !selectedIndexes.has(index)).map(({ item }) => item);
  return {
    engineId: input.engineId,
    limit,
    requested,
    selected,
    omitted,
    canSubmit: true,
    summary: `当前模型最多 ${limit} 张参考图，已按连续性、角色、主场景、道具优先级提交 ${selected.length}/${requested.length} 张，省略 ${omitted.length} 张`,
  };
}

export function imageReferenceProjectionPrompt(projection: ImageReferenceProjection): string {
  if (projection.omitted.length === 0) return '';
  return [
    '【生图参考图提交说明】',
    projection.summary,
    `实际提交：${projection.selected.map((item, index) => `图片${index + 1}=${item.label}`).join('；')}`,
    `未提交：${projection.omitted.map((item) => item.label).join('；')}`,
    '提示词中的图片编号只对应“实际提交”列表，不得引用未提交素材。',
    '【生图参考图提交说明结束】',
  ].join('\n');
}
