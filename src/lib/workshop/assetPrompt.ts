import { loadStyleLibrary } from '@/lib/styleLibrary';
import {
  applyMidjourneyStylePrompt,
  getMidjourneyStyle,
  loadMidjourneyStyleLibrary,
} from '@/lib/midjourney/styles';
import { buildColorPalettePrompt } from './colorPalettes';
import { useSpatialSceneViews } from './assetViewPolicy';
import { resolveAssetStyleReference, styleReferenceConstraint, type ResolvedStyleReference } from './stylePack';
import { buildCharacterSheetPrompt } from './workshopPrompts';
import type {
  WorkshopAssetKind,
  WorkshopData,
  WsCharacter,
  WsColorPalette,
  WsProp,
  WsScene,
} from './types';

export type AssetPromptItem = WsCharacter | WsScene | WsProp | WsColorPalette;
export type AssetStyleConfig = WorkshopData['style'];

export interface ResolvedAssetStyle {
  /** 风格库预设名；无风格库时为空。 */
  name?: string;
  /** 实际拼进生图请求的文本。 */
  suffix: string;
  /** 自定义关键词文本；用于生成“预设名 + 自定义补充”的实际样式段。 */
  customText?: string;
  /** 风格来自哪里，供 UI 标明并避免误以为资产提示词本身已包含画风。 */
  source: 'library' | 'keywords' | 'none';
}

export interface AssetBasePrompt {
  /** 未附加全片画风的可编辑基础提示词。 */
  basePrompt: string;
  /** 空提示词或旧版角色提示词时，生成逻辑使用的兜底模板。 */
  usedFallback: boolean;
  /** 旧版角色提示词会被替换为角色设定板模板。 */
  legacyCharacterPrompt: boolean;
}

export interface AssetPromptPlan extends AssetBasePrompt {
  /** 真正提交给生图服务的提示词。 */
  prompt: string;
  style: ResolvedAssetStyle;
  engine: string;
  isMidjourney: boolean;
  /** Visual style reference selected for this concrete asset kind. */
  styleReference?: ResolvedStyleReference;
}

const CHARACTER_SHEET_MARKER = /三视图|设定图|角色设定板|character design sheet|character bible|three-view/i;

function isMidjourneyEngine(engine: string): boolean {
  return engine.startsWith('midjourney');
}

function separator(isMj: boolean): string {
  return isMj ? ', ' : '，';
}

function storedAssetPrompt(item: AssetPromptItem, isMj: boolean): string | undefined {
  if (!isMj) return item.assetPrompt;
  return 'assetPromptMj' in item ? item.assetPromptMj : undefined;
}

function fallbackAssetPrompt(kind: WorkshopAssetKind, item: AssetPromptItem, isMj: boolean): string {
  if (isMj) {
    if (kind === 'character') {
      const character = item as WsCharacter;
      return buildCharacterSheetPrompt(character.name, character.appearance, 'en', {
        personality: character.personality,
        lifecycleStages: character.lifecycleStages,
      });
    }
    if (kind === 'scene') {
      const scene = item as WsScene;
      return `establishing shot of ${scene.description}, no people, concept art, cinematic lighting, high detail`;
    }
    if (kind === 'colorPalette') {
      const palette = item as WsColorPalette;
      return buildColorPalettePrompt(
        palette.name,
        palette.description ?? 'cinematic color system',
        palette.colors ?? [],
      );
    }
    const prop = item as WsProp;
    return `prop design, ${prop.name}, ${prop.description}, product photography, studio lighting, detailed, no text`;
  }

  if (kind === 'character') {
    const character = item as WsCharacter;
    return buildCharacterSheetPrompt(character.name, character.appearance, 'zh', {
      personality: character.personality,
      lifecycleStages: character.lifecycleStages,
    });
  }
  if (kind === 'scene') {
    const scene = item as WsScene;
    return `${scene.name}，${scene.description}，场景概念图，无人物，电影感布光，高质量`;
  }
  if (kind === 'colorPalette') {
    const palette = item as WsColorPalette;
    return buildColorPalettePrompt(
      palette.name,
      palette.description ?? 'cinematic color system',
      palette.colors ?? [],
    );
  }
  const prop = item as WsProp;
  return `${prop.name}，${prop.description}，道具设计图，产品摄影风格，细节丰富，无文字`;
}

/** 取资产的可编辑基础提示词；旧版角色提示词按现有生成规则切换到设定板模板。 */
export function buildAssetBasePrompt(
  kind: WorkshopAssetKind,
  item: AssetPromptItem,
  engine: string,
): AssetBasePrompt {
  const isMj = isMidjourneyEngine(engine);
  const stored = storedAssetPrompt(item, isMj)?.trim();
  const legacyCharacterPrompt = kind === 'character' && !isMj && Boolean(stored) && !CHARACTER_SHEET_MARKER.test(stored!);
  const usedFallback = !stored || legacyCharacterPrompt;
  return {
    basePrompt: usedFallback ? fallbackAssetPrompt(kind, item, isMj) : stored!,
    usedFallback,
    legacyCharacterPrompt,
  };
}

/** 解析项目级画风。生成和 UI 必须共用这一个函数，避免展示与实际请求不一致。 */
export async function resolveAssetStyle(
  style: AssetStyleConfig,
  engine: string,
): Promise<ResolvedAssetStyle> {
  if (!style) return { suffix: '', source: 'none' };
  const isMj = isMidjourneyEngine(engine);
  let styleSuffix = '';
  let styleName: string | undefined;
  let customText = '';

  if (style.styleLibraryRef) {
    const lib = style.library === 'midjourney'
      ? await loadMidjourneyStyleLibrary()
      : await loadStyleLibrary();
    const preset = lib.styles.find((candidate) => candidate.name === style.styleLibraryRef);
    styleName = preset?.name ?? style.styleLibraryRef;
    // Midjourney 预设模板由 applyMidjourneyStylePrompt 统一合成；若这里再拼一次，
    // `{subject}` 占位符会被嵌套替换后残留到最终请求。
    const deferToMidjourneyComposer = isMj && style.library === 'midjourney' && Boolean(preset);
    if (!deferToMidjourneyComposer) {
      styleSuffix = preset?.promptSuffix ?? preset?.promptTemplate ?? '';
    }
  }

  customText = [...(style.keywords ?? []), style.customText ?? ''].filter(Boolean).join(separator(isMj));

  if (!styleSuffix && !style.styleLibraryRef) {
    styleSuffix = customText;
  }

  return {
    ...(styleName ? { name: styleName } : {}),
    suffix: styleSuffix || customText,
    ...(customText && customText !== styleSuffix ? { customText } : {}),
    source: style.styleLibraryRef
      ? 'library'
      : (styleSuffix || customText ? 'keywords' : 'none'),
  };
}

function applyStyleToBasePrompt(
  kind: WorkshopAssetKind,
  engine: string,
  basePrompt: string,
  style: ResolvedAssetStyle,
): string {
  const sep = separator(isMidjourneyEngine(engine));

  // 角色设定板不把场景元素带进背景；只注入色调与角色气质。
  if (kind === 'character' && style.name) {
    const styleDescription = [style.name, style.customText].filter(Boolean).join('；');
    const characterStyleHint = isMidjourneyEngine(engine)
      ? `art style inspired by ${styleDescription}, keep plain light grey background, standard studio lighting, no scene elements`
      : `整体画风参考「${styleDescription}」的色调与角色气质，但严格保持纯色浅灰背景、标准摄影棚布光，不添加任何场景元素或多余光影`;
    return `${basePrompt}${sep}${characterStyleHint}`;
  }

  // 风格库预设与自定义补充是两层信息：选预设后仍要保留用户补充的关键词。
  // 逐项判断，避免只补其中一层或把已经存在于基础提示词中的内容重复拼接。
  const styleParts = [style.suffix, style.customText]
    .filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index)
    .filter((part) => !basePrompt.includes(part));
  if (styleParts.length === 0) return basePrompt;
  return `${basePrompt}${sep}${styleParts.join(sep)}`;
}

function appendSceneOverviewConstraint(
  prompt: string,
  engine: string,
  workKind: string | undefined,
): string {
  if (!useSpatialSceneViews('scene', workKind)) return prompt;
  if (/45.?degree|45.?度|斜俯视|俯视|top.?down|elevated.*wide.?angle|空间总览/i.test(prompt)) return prompt;
  const sep = separator(isMidjourneyEngine(engine));
  const overviewConstraint = isMidjourneyEngine(engine)
    ? 'empty environment overview, elevated 45-degree oblique top-down wide-angle view, complete room floor plan and spatial layout visible, walls, entrances, fixed furniture and spatial anchors clearly readable, realistic perspective, no people, no text, no watermark'
    : '约45°斜俯视的高位广角空间总览图，从上方看清完整平面布局、墙面关系、出入口、固定家具和主要空间锚点，保持真实透视，无人物、无文字、无水印；该视角仅用于建立场景空间母版，不代表后续分镜机位';
  return `${prompt}${sep}${overviewConstraint}`;
}

function appendSceneSingleViewConstraint(prompt: string, engine: string): string {
  const sep = separator(isMidjourneyEngine(engine));
  return `${prompt}${sep}${isMidjourneyEngine(engine)
    ? 'one image of one coherent environment from a single viewpoint, no split screen, collage, multi-view sheet or alternate angle'
    : '只生成一张、单一机位的完整场景图，不生成第二视角，不使用分屏、拼图或多视角组合图'}`;
}

/**
 * 生成资产生图请求的“最终提示词”。
 *
 * 该函数不执行付费生成，只把基础提示词、项目画风、场景视角约束和（可选）
 * 一致性参考说明合成在一起。store 与资产卡都必须调用它，UI 才能准确展示
 * 本次实际会提交的文本。
 */
export async function buildAssetPromptPlan(input: {
  kind: WorkshopAssetKind;
  item: AssetPromptItem;
  engine: string;
  style?: AssetStyleConfig;
  workKind?: string;
  hasExistingReference?: boolean;
}): Promise<AssetPromptPlan> {
  const { kind, item, engine, style, workKind, hasExistingReference = false } = input;
  const isMj = isMidjourneyEngine(engine);
  const base = buildAssetBasePrompt(kind, item, engine);
  const resolvedStyle = await resolveAssetStyle(style, engine);
  const styleReference = await resolveAssetStyleReference(style, kind);
  let prompt = applyStyleToBasePrompt(kind, engine, base.basePrompt, resolvedStyle);

  if (styleReference) {
    prompt = `${prompt}${separator(isMj)}${styleReferenceConstraint(styleReference.kind, styleReference.fallback)}`;
  }

  if (kind === 'scene') {
    prompt = appendSceneOverviewConstraint(prompt, engine, workKind);
  }

  if (isMj) {
    prompt = applyMidjourneyStylePrompt(prompt, getMidjourneyStyle(style?.midjourneyStyleId));
  }

  if (hasExistingReference) {
    const sep = separator(isMj);
    const consistencyHint = isMj
      ? 'use the supplied asset image as the identity and structure reference; preserve the same character identity, clothing construction, proportions, key features, environment layout and prop design, but re-render materials, line quality, color grading and lighting to match the current style reference instead of inheriting the old image style'
      : '使用已提供的资产图作为身份与结构参考，保持人物身份、服装结构、比例、关键特征、场景布局和道具设计；材质、线条、色彩与光影必须按当前风格参考重新渲染，不要沿用旧图的画风';
    prompt = `${prompt}${sep}${consistencyHint}`;
  }

  if (kind === 'scene') prompt = appendSceneSingleViewConstraint(prompt, engine);

  return {
    ...base,
    prompt,
    style: resolvedStyle,
    styleReference,
    engine,
    isMidjourney: isMj,
  };
}
