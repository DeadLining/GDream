import { QWEN3_TTS_DEFAULT_URL } from '@/lib/qwen3Tts/config';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { readTextFile, exists, BaseDirectory } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { safeLocalStorage } from '@/lib/safeStorage';
import { createSettingsStorage } from '@/lib/settingsPersistence';
import { migrateLegacyCredentials, type Credential } from '@/lib/credentials';
import type { ArkModelsCache } from '@/lib/channels/arkModels';
import type { AgentMeta } from '@/types/agent';
import {
  isLegacyMinimaxH3Endpoint,
  migrateMinimaxH3Endpoint,
  MINIMAX_H3_DEFAULT_ENDPOINT,
} from '@/lib/videoRouter/minimaxH3Config';

/** 生图 API 提供商 */
export type ImageProvider = 'dmxapi' | 'aihubmix' | 'zexapi' | 'custom';

/** 固化的提供商信息 */
export const IMAGE_PROVIDERS: Record<ImageProvider, { label: string; baseUrl: string }> = {
  dmxapi: { label: 'DMXAPI', baseUrl: 'https://www.dmxapi.cn' },
  aihubmix: { label: 'AiHubMix', baseUrl: 'https://api.inferera.com' },
  zexapi: { label: 'ZexAPI', baseUrl: 'https://zexapi.com' },
  custom: { label: '自定义 OpenAI 图片接口', baseUrl: '' },
};

// Dreamina CLI v1.4.12+ exposes Seedream 5.0 Pro as model_version=5.0Pro.
// It is part of the shared Seedream route and uses the local OAuth login.

export const OMNI_ZEXAPI_BASE_URL = 'https://zexapi.com';
export const OMNI_DEFAULT_BASE_URL = 'https://api.apimart.ai';
export const OMNI_DEFAULT_FALLBACK_BASE_URLS = [
  'https://apib.ai',
  'https://aiuxu.com',
  'https://aishuch.com',
];
export const OMNI_DEFAULT_CREDIT_PRICE_PER_10 = 7;

/** 生图 API 槽位 */
export interface ImageApiSlot {
  id: string;
  label: string;
  provider: ImageProvider;
  baseUrl: string;
  /** @deprecated 兼容路径：优先用 credentialId 引用凭证注册表，apiKey 仅作回退。 */
  apiKey: string;
  /** 自定义 OpenAI 图片接口使用的模型 ID；为空时回退到全局图片模型。 */
  model?: string;
  /** 引用凭证注册表（settingsStore.credentials）中的凭证；读取时优先于 apiKey。 */
  credentialId?: string;
  enabled: boolean;
  priority: number;
  mode?: 'text-to-image' | 'image-to-image';
  tier?: 'cheap' | 'standard';
}

/**
 * 旧 key setter 的写透镜像：该能力若已挂凭证引用，把新 key 同步写进凭证，
 * 保证无论从「API 凭证」页还是旧字段入口修改，所有消费方都读到同一份。
 */
function mirrorCredentialWrite(
  state: { credentials: Credential[]; credentialRefs: Record<string, string> },
  cap: string,
  apiKey: string,
): { credentials?: Credential[] } {
  const refId = state.credentialRefs?.[cap];
  if (!refId) return {};
  let changed = false;
  const credentials = state.credentials.map((c) => {
    if (c.id !== refId || c.apiKey === apiKey) return c;
    changed = true;
    return { ...c, apiKey };
  });
  return changed ? { credentials } : {};
}

// Disk is authoritative; the app waits for hydration before mounting any effects.
const SETTINGS_REL_PATH = '.gdream/settings.json';
const LS_KEY = 'gdream-settings';
export const SETTINGS_PERSISTENCE_ERROR = 'gdream-settings-persistence-error';
let settingsPersistenceFailed = false;
export function hasSettingsPersistenceError(): boolean { return settingsPersistenceFailed; }

const hybridStateStorage = createSettingsStorage({
  cache: safeLocalStorage,
  readFile: async () => {
    if (!await exists(SETTINGS_REL_PATH, { dir: BaseDirectory.Home })) return null;
    return readTextFile(SETTINGS_REL_PATH, { dir: BaseDirectory.Home });
  },
  writeFile: (contents, expectedContents) => invoke('write_text_file_private', {
    path: SETTINGS_REL_PATH, contents, expectedContents, checkExisting: true,
  }),
  onError: () => {
    settingsPersistenceFailed = true;
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(SETTINGS_PERSISTENCE_ERROR));
    }
  },
});

export async function initializeSettings(): Promise<void> {
  settingsPersistenceFailed = false;
  await useSettingsStore.persist.rehydrate();
  await hybridStateStorage.flush();
  if (!useSettingsStore.persist.hasHydrated() || settingsPersistenceFailed) {
    throw new Error('无法安全加载设置，已阻止覆盖现有配置。');
  }
}

// ── Store ──────────────────────────────────────────────────────────────────────

interface SettingsState {
  // Setup wizard
  setupComplete: boolean;
  setSetupComplete: (complete: boolean) => void;
  /** 用户主动跳过初始引导；true 时不再自动弹向导，设置页显示补配横幅。 */
  setupSkipped: boolean;
  setSetupSkipped: (skipped: boolean) => void;
  /** 引导向导浮层开关（设置页横幅可重新打开）。 */
  wizardOpen: boolean;
  setWizardOpen: (open: boolean) => void;

  // Agent metadata (dynamic, user-configurable)
  agentMetas: Record<string, AgentMeta>;
  setAgentMeta: (agentId: string, meta: AgentMeta) => void;
  setAllAgentMetas: (metas: Record<string, AgentMeta>) => void;

  // Session titles generated locally (persisted, set once per session)
  sessionTitles: Record<string, string>;
  setSessionTitle: (sessionId: string, title: string) => void;

  // Client-side deleted session IDs (persisted so they survive page reload)
  deletedSessionIds: string[];
  addDeletedSessionId: (id: string) => void;

  // Sound
  soundEnabled: boolean;
  soundVolume: number;
  setSoundEnabled: (enabled: boolean) => void;
  setSoundVolume: (volume: number) => void;

  // Agent Engine (GDream)
  glmApiKey: string;
  glmBaseUrl: string;
  glmModel: string;
  defaultCwd: string;
  setGlmApiKey: (key: string) => void;
  setGlmBaseUrl: (url: string) => void;
  setGlmModel: (model: string) => void;
  setDefaultCwd: (cwd: string) => void;

  // Agent 工具确认模式：manual=危险操作弹窗确认；auto=跳过确认直接执行
  toolConfirmMode: 'manual' | 'auto';
  setToolConfirmMode: (m: 'manual' | 'auto') => void;

  // Agent
  defaultAgentId: string | null;
  setDefaultAgentId: (id: string | null) => void;

  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;

  // API Keys
  geminiApiKey: string;
  setGeminiApiKey: (key: string) => void;
  dmxApiKey: string;
  setDmxApiKey: (key: string) => void;
  bananaProApiKey: string;
  setBananaProApiKey: (key: string) => void;
  arkApiKey: string;
  setArkApiKey: (key: string) => void;
  /** Ark 模型列表本地缓存（设置页「同步模型列表」写入；null = 未同步过，回退静态注册表） */
  arkModelsCache: ArkModelsCache | null;
  setArkModelsCache: (cache: ArkModelsCache | null) => void;
  happyHorseBaseUrl: string;
  happyHorseApiKey: string;
  setHappyHorseBaseUrl: (url: string) => void;
  setHappyHorseApiKey: (key: string) => void;
  runninghubApiKey: string;
  setRunninghubApiKey: (key: string) => void;
  kuaiziApiKey: string;
  setKuaiziApiKey: (key: string) => void;
  useRhtvSeedance: boolean;
  setUseRhtvSeedance: (enabled: boolean) => void;
  /** Seedance 2.0 通道选择：kuaizi=筷子丽帧（默认）；runninghub=RHTV；ark=火山方舟。
   *  取代旧的 useRhtvSeedance 布尔（v31 迁移保留原选择）。 */
  seedanceEngine: 'kuaizi' | 'runninghub' | 'ark' | 'custom';
  setSeedanceEngine: (engine: 'kuaizi' | 'runninghub' | 'ark' | 'custom') => void;
  customVideoBaseUrl: string;
  customVideoApiKey: string;
  customVideoModel: string;
  customVideoCreatePath: string;
  customVideoStatusPath: string;
  customVideoProvider: 'vllm-omni' | 'minimax-api' | 'generic-api';
  customVideoApiBaseUrl: string;
  customVideoNativeApiKey: string;
  customVideoApiModel: string;
  customVideoGenericBaseUrl: string;
  customVideoGenericApiKey: string;
  customVideoGenericCreatePath: string;
  customVideoGenericStatusPath: string;
  customVideoGenericProtocol: 'ltx-json' | 'sglang-h3';
  customVideoGenericModel: string;
  customVideoGenericH3Task: 'i2va' | 'fl2va' | 'ref2va' | 't2va';
  customVideoGenericH3ShortEdge: string;
  customVideoGenericH3AspectRatio: string;
  customVideoGenericH3Quality: string;
  customVideoGenericH3NumOutputs: string;
  customVideoGenericH3InferenceSteps: string;
  customVideoGenericH3FlowShift: string;
  customVideoGenericH3AudioFlowShift: string;
  customVideoGenericH3Seed: string;
  setCustomVideoBaseUrl: (value: string) => void;
  setCustomVideoNativeApiKey: (value: string) => void;
  setCustomVideoModel: (value: string) => void;
  setCustomVideoCreatePath: (value: string) => void;
  setCustomVideoStatusPath: (value: string) => void;
  setCustomVideoProvider: (value: SettingsState['customVideoProvider']) => void;
  setCustomVideoApiBaseUrl: (value: string) => void;
  setCustomVideoApiKey: (value: string) => void;
  setCustomVideoApiModel: (value: string) => void;
  setCustomVideoGenericBaseUrl: (value: string) => void;
  setCustomVideoGenericApiKey: (value: string) => void;
  setCustomVideoGenericCreatePath: (value: string) => void;
  setCustomVideoGenericStatusPath: (value: string) => void;
  setCustomVideoGenericProtocol: (value: SettingsState['customVideoGenericProtocol']) => void;
  setCustomVideoGenericModel: (value: string) => void;
  setCustomVideoGenericH3Task: (value: SettingsState['customVideoGenericH3Task']) => void;
  setCustomVideoGenericH3ShortEdge: (value: string) => void;
  setCustomVideoGenericH3AspectRatio: (value: string) => void;
  setCustomVideoGenericH3Quality: (value: string) => void;
  setCustomVideoGenericH3NumOutputs: (value: string) => void;
  setCustomVideoGenericH3InferenceSteps: (value: string) => void;
  setCustomVideoGenericH3FlowShift: (value: string) => void;
  setCustomVideoGenericH3AudioFlowShift: (value: string) => void;
  setCustomVideoGenericH3Seed: (value: string) => void;
  /** MiniMax H3 渠道偏好：auto=按健康度自动容灾（默认）；其余值优先对应渠道，失败仍容灾其他已配置渠道。 */
  minimaxH3Channel: 'auto' | 'runninghub' | 'apimart' | 'kuaizi' | 'custom';
  setMinimaxH3Channel: (channel: 'auto' | 'runninghub' | 'apimart' | 'kuaizi' | 'custom') => void;
  /** 万相 3.0 渠道偏好：auto=筷子主渠道按健康度容灾（默认）；其余=优先该渠道，失败仍容灾剩余渠道。 */
  wan3Channel: 'auto' | 'custom' | 'kuaizi' | 'runninghub' | 'apimart';
  setWan3Channel: (channel: 'auto' | 'custom' | 'kuaizi' | 'runninghub' | 'apimart') => void;
  kimiEditModel: string;
  setKimiEditModel: (model: string) => void;
  kimiEditUseCos: boolean;
  setKimiEditUseCos: (enabled: boolean) => void;
  /** Default character voice sample service; separate from shot dubbing/ASR. */
  qwen3TtsBaseUrl: string;
  setQwen3TtsBaseUrl: (url: string) => void;
  doubaoSpeechApiKey: string;
  setDoubaoSpeechApiKey: (key: string) => void;
  // 配音通道：true=筷子丽帧 seed_audio 优先（失败自动回退豆包官方）；false=豆包官方
  speechKuaiziFirst: boolean;
  setSpeechKuaiziFirst: (enabled: boolean) => void;
  omniApiKey: string;
  omniZeroFallApiKey: string;
  omniApimartApiKey: string;
  omniBaseUrl: string;
  omniFallbackBaseUrls: string[];
  omniCreditPricePer10: number;
  setOmniApiKey: (key: string) => void;
  setOmniZeroFallApiKey: (key: string) => void;
  setOmniApimartApiKey: (key: string) => void;
  setOmniBaseUrl: (url: string) => void;
  setOmniFallbackBaseUrls: (urls: string[]) => void;
  setOmniCreditPricePer10: (price: number) => void;

  // Tencent COS
  cosBucket: string;
  cosRegion: string;
  cosSecretId: string;
  cosSecretKey: string;
  cosTransitEndpoint: string;
  setCosBucket: (v: string) => void;
  setCosRegion: (v: string) => void;
  setCosSecretId: (v: string) => void;
  setCosSecretKey: (v: string) => void;
  setCosTransitEndpoint: (v: string) => void;

  // Optional display name used in greetings (「你好！」 when empty).
  // Private builds can preset it via private.defaults.json (gitignored).
  greetingName: string;
  setGreetingName: (v: string) => void;

  // Unread tracking (persisted)
  sessionLastReadAt: Record<string, number>;
  markSessionRead: (sessionId: string) => void;

  // Multi-provider (Tier 1.5) — keyed by provider id (`glm`, `deepseek`, ...)
  providerApiKeys: Record<string, string>;
  setProviderApiKey: (providerId: string, key: string) => void;
  // Per-provider base URL + model overrides (empty = provider's default).
  providerBaseUrls: Record<string, string>;
  providerModels: Record<string, string>;
  setProviderBaseUrl: (providerId: string, url: string) => void;
  setProviderModel: (providerId: string, model: string) => void;
  // Default provider id + ordered fallback chain; router consumes these.
  providerDefault: string;
  providerFallbackChain: string[];
  setProviderDefault: (id: string) => void;
  setProviderFallbackChain: (chain: string[]) => void;
  // Optional per-workspace LLM override. Missing/"global" inherits the global
  // providerDefault + providerModels selection.
  workspaceAgentModels: Record<'canvas' | 'workshop' | 'editor', string>;
  setWorkspaceAgentModel: (scope: 'canvas' | 'workshop' | 'editor', selection: string) => void;

  // Composer model preferences. These guide normal-chat generation tools;
  // canvas/workshop nodes keep their own per-node model settings.
  chatImageModel: 'gpt-image-2' | 'seedream-v5-pro' | 'midjourney-v81' | 'midjourney-v82';
  chatVideoModel: 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-2.0-mini' | 'seedance-2.5' | 'minimax-h3' | 'omni-mg-animation' | 'wan-3.0';
  setChatImageModel: (model: SettingsState['chatImageModel']) => void;
  setChatVideoModel: (model: SettingsState['chatVideoModel']) => void;

  // Workshop multimodal quality review. API key is referenced only through
  // credentialRefs.qualityReview and never duplicated into a plain field.
  qualityReviewEnabled: boolean;
  qualityReviewBaseUrl: string;
  qualityReviewModel: string;
  qualityReviewMaxFrameAttempts: number;
  setQualityReviewEnabled: (enabled: boolean) => void;
  setQualityReviewBaseUrl: (url: string) => void;
  setQualityReviewModel: (model: string) => void;
  setQualityReviewMaxFrameAttempts: (attempts: number) => void;

  // Tier 4: Output style & UX
  outputStyle: 'default' | 'concise' | 'verbose' | 'coding';
  setOutputStyle: (style: SettingsState['outputStyle']) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
  // 联网搜索开关（默认关闭；开启后 web_search 工具才暴露给模型）
  webSearchEnabled: boolean;
  setWebSearchEnabled: (enabled: boolean) => void;

  // 生图 API 槽位（多 API 降级链）
  imageApiSlots: ImageApiSlot[];
  setImageApiSlots: (slots: ImageApiSlot[]) => void;
  // 测速缓存（slotId → {latencyMs, testedAt}）
  imageApiLatency: Record<string, { latencyMs: number; testedAt: number }>;
  setImageApiLatency: (id: string, latencyMs: number) => void;

  // ── 凭证注册表（API Key 单一事实源）──
  // 旧平铺 key 字段全部保留作 resolver 回退；读侧经 resolveApiKey/resolveSlotApiKey。
  credentials: Credential[];
  /** capability → credentialId。capability 取值：'dmx'/'ark'/.../'cos'、'provider:<id>'。 */
  credentialRefs: Record<string, string>;
  upsertCredential: (cred: Credential) => void;
  removeCredential: (id: string) => void;
  setCredentialRef: (cap: string, credentialId: string | null) => void;

}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Setup wizard
      setupComplete: false,
      setSetupComplete: (setupComplete) => set({ setupComplete }),
      setupSkipped: false,
      setSetupSkipped: (setupSkipped) => set({ setupSkipped }),
      wizardOpen: false,
      setWizardOpen: (wizardOpen) => set({ wizardOpen }),

      // Agent metadata
      agentMetas: {},
      setAgentMeta: (agentId, meta) =>
        set((state) => ({ agentMetas: { ...state.agentMetas, [agentId]: meta } })),
      setAllAgentMetas: (agentMetas) => set({ agentMetas }),

      // Session titles
      sessionTitles: {},
      setSessionTitle: (sessionId, title) =>
        set((state) => ({ sessionTitles: { ...state.sessionTitles, [sessionId]: title } })),

      // Deleted sessions (client-side soft-delete)
      deletedSessionIds: [],
      addDeletedSessionId: (id) =>
        set((state) => ({
          deletedSessionIds: state.deletedSessionIds.includes(id)
            ? state.deletedSessionIds
            : [...state.deletedSessionIds, id],
        })),

      // Sound
      soundEnabled: true,
      soundVolume: 0.5,
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setSoundVolume: (soundVolume) => set({ soundVolume }),

      // Agent Engine (GDream)
      glmApiKey: '',
      glmBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
      glmModel: 'glm-5.3',
      defaultCwd: '',
      setGlmApiKey: (glmApiKey) => set((s) => ({ glmApiKey, ...mirrorCredentialWrite(s, 'glm', glmApiKey) })),
      setGlmBaseUrl: (glmBaseUrl) => set({ glmBaseUrl }),
      setGlmModel: (glmModel) => set({ glmModel }),
      setDefaultCwd: (defaultCwd) => set({ defaultCwd }),

      toolConfirmMode: 'manual' as const,
      setToolConfirmMode: (m) => set({ toolConfirmMode: m }),

      // Agent
      defaultAgentId: null,
      setDefaultAgentId: (defaultAgentId) => set({ defaultAgentId }),

      // Theme
      theme: 'light',
      setTheme: (theme) => set({ theme }),

      // API Keys（旧字段 deprecated：保留作 resolver 回退；写时镜像到凭证注册表）
      geminiApiKey: '',
      setGeminiApiKey: (geminiApiKey) => set((s) => ({ geminiApiKey, ...mirrorCredentialWrite(s, 'gemini', geminiApiKey) })),
      dmxApiKey: '',
      setDmxApiKey: (dmxApiKey) => set((s) => ({ dmxApiKey, ...mirrorCredentialWrite(s, 'dmx', dmxApiKey) })),
      bananaProApiKey: '',
      setBananaProApiKey: (bananaProApiKey) => set((s) => ({ bananaProApiKey, ...mirrorCredentialWrite(s, 'bananaPro', bananaProApiKey) })),
      arkApiKey: '',
      setArkApiKey: (arkApiKey) => set((s) => ({ arkApiKey, ...mirrorCredentialWrite(s, 'ark', arkApiKey) })),
      arkModelsCache: null,
      setArkModelsCache: (arkModelsCache) => set({ arkModelsCache }),
      happyHorseBaseUrl: '',
      happyHorseApiKey: '',
      setHappyHorseBaseUrl: (happyHorseBaseUrl) => set({ happyHorseBaseUrl }),
      setHappyHorseApiKey: (happyHorseApiKey) => set((s) => ({ happyHorseApiKey, ...mirrorCredentialWrite(s, 'happyHorse', happyHorseApiKey) })),
      runninghubApiKey: '',
      setRunninghubApiKey: (runninghubApiKey) => set((s) => ({ runninghubApiKey, ...mirrorCredentialWrite(s, 'runninghub', runninghubApiKey) })),
      kuaiziApiKey: '',
      setKuaiziApiKey: (kuaiziApiKey) => set((s) => ({ kuaiziApiKey, ...mirrorCredentialWrite(s, 'kuaizi', kuaiziApiKey) })),
      useRhtvSeedance: false,
      setUseRhtvSeedance: (useRhtvSeedance) => set({ useRhtvSeedance }),
      seedanceEngine: 'kuaizi',
      setSeedanceEngine: (seedanceEngine) => set({ seedanceEngine }),
      customVideoBaseUrl: 'http://127.0.0.1:8000',
      customVideoApiKey: '',
      customVideoModel: '',
      customVideoCreatePath: '/v1/videos',
      customVideoStatusPath: '/v1/videos/{id}',
      customVideoProvider: 'generic-api',
      customVideoApiBaseUrl: '',
      customVideoNativeApiKey: '',
      customVideoApiModel: '',
      customVideoGenericBaseUrl: MINIMAX_H3_DEFAULT_ENDPOINT,
      customVideoGenericApiKey: '',
      customVideoGenericCreatePath: '/v1/videos',
      customVideoGenericStatusPath: '/v1/videos/{id}',
      customVideoGenericProtocol: 'sglang-h3',
      customVideoGenericModel: 'MiniMaxAI/MiniMax-H3',
      customVideoGenericH3Task: 'ref2va',
      customVideoGenericH3ShortEdge: '768',
      customVideoGenericH3AspectRatio: 'auto',
      customVideoGenericH3Quality: 'lossless',
      customVideoGenericH3NumOutputs: '1',
      customVideoGenericH3InferenceSteps: '8',
      customVideoGenericH3FlowShift: '12',
      customVideoGenericH3AudioFlowShift: '3',
      customVideoGenericH3Seed: '3104',
      setCustomVideoBaseUrl: (customVideoBaseUrl) => set({ customVideoBaseUrl }),
      setCustomVideoApiKey: (customVideoApiKey) => set((s) => ({ customVideoApiKey, ...mirrorCredentialWrite(s, 'customVideo', customVideoApiKey) })),
      setCustomVideoModel: (customVideoModel) => set({ customVideoModel }),
      setCustomVideoCreatePath: (customVideoCreatePath) => set({ customVideoCreatePath }),
      setCustomVideoStatusPath: (customVideoStatusPath) => set({ customVideoStatusPath }),
      setCustomVideoProvider: (customVideoProvider) => set((s) => ({
        customVideoProvider,
        ...(customVideoProvider === 'generic-api'
          ? { minimaxH3Channel: s.customVideoGenericProtocol === 'sglang-h3' ? 'custom' as const : 'auto' as const }
          : s.minimaxH3Channel === 'custom'
            ? { minimaxH3Channel: 'auto' as const }
            : {}),
      })),
      setCustomVideoApiBaseUrl: (customVideoApiBaseUrl) => set({ customVideoApiBaseUrl }),
      setCustomVideoNativeApiKey: (customVideoNativeApiKey) => set((s) => ({ customVideoNativeApiKey, ...mirrorCredentialWrite(s, 'customVideoApi', customVideoNativeApiKey) })),
      setCustomVideoApiModel: (customVideoApiModel) => set({ customVideoApiModel }),
      setCustomVideoGenericBaseUrl: (customVideoGenericBaseUrl) => set({ customVideoGenericBaseUrl }),
      setCustomVideoGenericApiKey: (customVideoGenericApiKey) => set((s) => ({ customVideoGenericApiKey, ...mirrorCredentialWrite(s, 'customVideoGeneric', customVideoGenericApiKey) })),
      setCustomVideoGenericCreatePath: (customVideoGenericCreatePath) => set({ customVideoGenericCreatePath }),
      setCustomVideoGenericStatusPath: (customVideoGenericStatusPath) => set({ customVideoGenericStatusPath }),
      setCustomVideoGenericProtocol: (customVideoGenericProtocol) => set((s) => ({
        customVideoGenericProtocol,
        ...(s.customVideoProvider === 'generic-api'
          ? { minimaxH3Channel: customVideoGenericProtocol === 'sglang-h3' ? 'custom' as const : 'auto' as const }
          : {}),
      })),
      setCustomVideoGenericModel: (customVideoGenericModel) => set({ customVideoGenericModel }),
      setCustomVideoGenericH3Task: (customVideoGenericH3Task) => set({ customVideoGenericH3Task }),
      setCustomVideoGenericH3ShortEdge: (customVideoGenericH3ShortEdge) => set({ customVideoGenericH3ShortEdge }),
      setCustomVideoGenericH3AspectRatio: (customVideoGenericH3AspectRatio) => set({ customVideoGenericH3AspectRatio }),
      setCustomVideoGenericH3Quality: (customVideoGenericH3Quality) => set({ customVideoGenericH3Quality }),
      setCustomVideoGenericH3NumOutputs: (customVideoGenericH3NumOutputs) => set({ customVideoGenericH3NumOutputs }),
      setCustomVideoGenericH3InferenceSteps: (customVideoGenericH3InferenceSteps) => set({ customVideoGenericH3InferenceSteps }),
      setCustomVideoGenericH3FlowShift: (customVideoGenericH3FlowShift) => set({ customVideoGenericH3FlowShift }),
      setCustomVideoGenericH3AudioFlowShift: (customVideoGenericH3AudioFlowShift) => set({ customVideoGenericH3AudioFlowShift }),
      setCustomVideoGenericH3Seed: (customVideoGenericH3Seed) => set({ customVideoGenericH3Seed }),
      minimaxH3Channel: 'custom',
      setMinimaxH3Channel: (minimaxH3Channel) => set(
        minimaxH3Channel === 'custom'
          ? { minimaxH3Channel, customVideoProvider: 'generic-api' }
          : { minimaxH3Channel },
      ),
      wan3Channel: 'auto',
      setWan3Channel: (wan3Channel) => set({ wan3Channel }),
      kimiEditModel: '',
      setKimiEditModel: (kimiEditModel) => set({ kimiEditModel }),
      kimiEditUseCos: true,
      setKimiEditUseCos: (kimiEditUseCos) => set({ kimiEditUseCos }),
      qwen3TtsBaseUrl: QWEN3_TTS_DEFAULT_URL,
      setQwen3TtsBaseUrl: (qwen3TtsBaseUrl) => set({ qwen3TtsBaseUrl }),
      doubaoSpeechApiKey: '',
      setDoubaoSpeechApiKey: (doubaoSpeechApiKey) => set((s) => ({ doubaoSpeechApiKey, ...mirrorCredentialWrite(s, 'doubaoSpeech', doubaoSpeechApiKey) })),
      speechKuaiziFirst: true,
      setSpeechKuaiziFirst: (speechKuaiziFirst) => set({ speechKuaiziFirst }),
      omniApiKey: '',
      omniZeroFallApiKey: '',
      omniApimartApiKey: '',
      omniBaseUrl: OMNI_DEFAULT_BASE_URL,
      omniFallbackBaseUrls: OMNI_DEFAULT_FALLBACK_BASE_URLS,
      omniCreditPricePer10: OMNI_DEFAULT_CREDIT_PRICE_PER_10,
      setOmniApiKey: (omniApiKey) => set((s) => ({ omniApiKey, ...mirrorCredentialWrite(s, 'omni', omniApiKey) })),
      setOmniZeroFallApiKey: (omniZeroFallApiKey) => set((s) => ({ omniZeroFallApiKey, ...mirrorCredentialWrite(s, 'omniZeroFall', omniZeroFallApiKey) })),
      setOmniApimartApiKey: (omniApimartApiKey) => set((s) => ({ omniApimartApiKey, ...mirrorCredentialWrite(s, 'omniApimart', omniApimartApiKey) })),
      setOmniBaseUrl: (omniBaseUrl) => set({ omniBaseUrl }),
      setOmniFallbackBaseUrls: (omniFallbackBaseUrls) => set({ omniFallbackBaseUrls }),
      setOmniCreditPricePer10: (omniCreditPricePer10) => set({ omniCreditPricePer10 }),

      // Tencent COS
      cosBucket: '',
      cosRegion: 'ap-guangzhou',
      cosSecretId: '',
      cosSecretKey: '',
      cosTransitEndpoint: '',
      setCosBucket: (cosBucket) => set({ cosBucket }),
      setCosRegion: (cosRegion) => set({ cosRegion }),
      // COS 凭证以 `SecretId:SecretKey` 合并存储，写两侧都镜像合成值
      setCosSecretId: (cosSecretId) => set((s) => ({
        cosSecretId,
        ...mirrorCredentialWrite(s, 'cos', `${cosSecretId}:${s.cosSecretKey}`),
      })),
      setCosSecretKey: (cosSecretKey) => set((s) => ({
        cosSecretKey,
        ...mirrorCredentialWrite(s, 'cos', `${s.cosSecretId}:${cosSecretKey}`),
      })),
      setCosTransitEndpoint: (cosTransitEndpoint) => set({ cosTransitEndpoint }),
      greetingName: '',
      setGreetingName: (greetingName) => set({ greetingName }),

      // Unread tracking
      sessionLastReadAt: {},
      markSessionRead: (sessionId) =>
        set((state) => ({
          sessionLastReadAt: { ...state.sessionLastReadAt, [sessionId]: Date.now() },
        })),

      // Multi-provider (Tier 1.5)
      providerApiKeys: {},
      setProviderApiKey: (providerId, key) =>
        set((state) => ({
          providerApiKeys: { ...state.providerApiKeys, [providerId]: key },
          ...mirrorCredentialWrite(state, `provider:${providerId}`, key),
        })),
      providerBaseUrls: {},
      providerModels: {},
      setProviderBaseUrl: (providerId, url) =>
        set((state) => ({
          providerBaseUrls: { ...state.providerBaseUrls, [providerId]: url },
        })),
      setProviderModel: (providerId, model) =>
        set((state) => ({
          providerModels: { ...state.providerModels, [providerId]: model },
        })),
      providerDefault: 'deepseek',
      providerFallbackChain: ['deepseek', 'glm'],
      setProviderDefault: (providerDefault) => set({ providerDefault }),
      setProviderFallbackChain: (providerFallbackChain) => set({ providerFallbackChain }),
      workspaceAgentModels: {
        canvas: 'global',
        workshop: 'global',
        editor: 'global',
      },
      setWorkspaceAgentModel: (scope, selection) =>
        set((state) => ({
          workspaceAgentModels: { ...state.workspaceAgentModels, [scope]: selection },
        })),
      chatImageModel: 'gpt-image-2',
      chatVideoModel: 'seedance-2.0',
      setChatImageModel: (chatImageModel) => set({ chatImageModel }),
      setChatVideoModel: (chatVideoModel) => set({ chatVideoModel }),
      qualityReviewEnabled: false,
      qualityReviewBaseUrl: 'http://127.0.0.1:30377',
      qualityReviewModel: 'qwen3.8-27b',
      qualityReviewMaxFrameAttempts: 3,
      setQualityReviewEnabled: (qualityReviewEnabled) => set({ qualityReviewEnabled }),
      setQualityReviewBaseUrl: (qualityReviewBaseUrl) => set({ qualityReviewBaseUrl }),
      setQualityReviewModel: (qualityReviewModel) => set({ qualityReviewModel }),
      setQualityReviewMaxFrameAttempts: (qualityReviewMaxFrameAttempts) => set({
        qualityReviewMaxFrameAttempts: Math.max(1, Math.min(3, Math.round(qualityReviewMaxFrameAttempts))),
      }),

      // Tier 4
      outputStyle: 'default',
      setOutputStyle: (outputStyle) => set({ outputStyle }),
      notificationsEnabled: true,
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      webSearchEnabled: false,
      setWebSearchEnabled: (webSearchEnabled) => set({ webSearchEnabled }),

      // 生图 API 槽位
      imageApiSlots: [],
      setImageApiSlots: (imageApiSlots) =>
        set((state) => {
          // 槽位挂了 credentialId 时，把内联 apiKey 的修改镜像写回凭证
          let credentials = state.credentials;
          let changed = false;
          for (const slot of imageApiSlots) {
            if (!slot.credentialId) continue;
            const idx = credentials.findIndex((c) => c.id === slot.credentialId);
            if (idx >= 0 && credentials[idx].apiKey !== slot.apiKey) {
              if (!changed) { credentials = [...credentials]; changed = true; }
              credentials[idx] = { ...credentials[idx], apiKey: slot.apiKey };
            }
          }
          return changed ? { imageApiSlots, credentials } : { imageApiSlots };
        }),
      imageApiLatency: {},
      setImageApiLatency: (id, latencyMs) =>
        set((state) => ({
          imageApiLatency: {
            ...state.imageApiLatency,
            [id]: { latencyMs, testedAt: Date.now() },
          },
        })),

      // 凭证注册表
      credentials: [],
      credentialRefs: {},
      upsertCredential: (cred) =>
        set((state) => ({
          credentials: state.credentials.some((c) => c.id === cred.id)
            ? state.credentials.map((c) => (c.id === cred.id ? cred : c))
            : [...state.credentials, cred],
        })),
      removeCredential: (id) =>
        set((state) => ({
          credentials: state.credentials.filter((c) => c.id !== id),
          // 摘掉所有引用，resolver 自动回退旧字段，删除凭证不会造成能力失效
          credentialRefs: Object.fromEntries(
            Object.entries(state.credentialRefs).filter(([, refId]) => refId !== id),
          ),
          imageApiSlots: state.imageApiSlots.map((slot) =>
            slot.credentialId === id ? { ...slot, credentialId: undefined } : slot,
          ),
        })),
      setCredentialRef: (cap, credentialId) =>
        set((state) => {
          const credentialRefs = { ...state.credentialRefs };
          if (credentialId) credentialRefs[cap] = credentialId;
          else delete credentialRefs[cap];
          return { credentialRefs };
        }),

    }),
    {
      name: LS_KEY,
      storage: createJSONStorage(() => hybridStateStorage),
      skipHydration: true,
      version: 45,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as Partial<SettingsState>;
        let result = { ...state } as any;
        if (version <= 4) {
          delete result.openclawPath;
          delete result.gatewayUrl;
          delete result.gatewayToken;
          result.glmApiKey = result.glmApiKey ?? '';
          result.glmBaseUrl = result.glmBaseUrl ?? 'https://open.bigmodel.cn/api/anthropic';
          result.glmModel = result.glmModel ?? 'glm-5.1';
          result.defaultCwd = result.defaultCwd ?? '';
        }
        if (version <= 6) {
          // v6 → v7: switch to Anthropic Messages API endpoint (Claude Code compatible)
          const OLD_URLS = [
            'https://open.bigmodel.cn/api/paas/v4',
            'https://open.bigmodel.cn/api/coding/paas/v4',
          ];
          if (!result.glmBaseUrl || OLD_URLS.includes(result.glmBaseUrl)) {
            result.glmBaseUrl = 'https://open.bigmodel.cn/api/anthropic';
          }
        }
        if (version <= 7) {
          // v7 → v8: seed multi-provider map from the existing single glmApiKey
          // so existing users don't have to re-paste.
          result.providerApiKeys = result.providerApiKeys ?? {};
          if (result.glmApiKey && !result.providerApiKeys.glm) {
            result.providerApiKeys.glm = result.glmApiKey;
          }
          result.providerDefault = result.providerDefault ?? 'glm';
          result.providerFallbackChain = result.providerFallbackChain ?? ['glm', 'deepseek'];
        }
        if (version <= 8) {
          // v8 → v9: seed per-provider baseUrl/model from legacy glm fields
          result.providerBaseUrls = result.providerBaseUrls ?? {};
          result.providerModels = result.providerModels ?? {};
          if (result.glmBaseUrl && !result.providerBaseUrls.glm) {
            result.providerBaseUrls.glm = result.glmBaseUrl;
          }
          if (result.glmModel && !result.providerModels.glm) {
            result.providerModels.glm = result.glmModel;
          }
        }
        if (version <= 9) {
          // v9 → v10: seed imageApiSlots from existing dmxApiKey
          result.imageApiSlots = result.imageApiSlots ?? [];
          result.imageApiLatency = result.imageApiLatency ?? {};
          if (result.dmxApiKey && result.imageApiSlots.length === 0) {
            result.imageApiSlots = [{
              id: 'dmxapi-default',
              label: 'DMXAPI',
              provider: 'dmxapi' as ImageProvider,
              baseUrl: 'https://www.dmxapi.cn',
              apiKey: result.dmxApiKey,
              enabled: true,
              priority: 0,
            }];
          }
        }
        if (version <= 10) {
          // v10 → v11: add HappyHorse fields
          result.happyHorseBaseUrl = result.happyHorseBaseUrl ?? '';
          result.happyHorseApiKey = result.happyHorseApiKey ?? '';
        }
        if (version <= 11) {
          // v11 → v12: add provider field to imageApiSlots, fix baseUrl
          if (Array.isArray(result.imageApiSlots)) {
            result.imageApiSlots = result.imageApiSlots.map((s: any) => {
              if (s.provider) return s; // already migrated
              let provider: ImageProvider = 'dmxapi';
              if (s.baseUrl?.includes('aihubmix')) provider = 'aihubmix';
              const info = IMAGE_PROVIDERS[provider];
              return { ...s, provider, baseUrl: info.baseUrl, label: s.label || info.label };
            });
          }
        }
        if (version <= 12) delete result.lastContextMemoryPath;
        if (version <= 13) {
          // v13 → v14: add Kuaizi LZ Seedance key for hidden provider trials
          result.kuaiziApiKey = result.kuaiziApiKey ?? '';
          if (result.useRhtvSeedance === undefined) result.useRhtvSeedance = false;
        }
        if (version <= 14) {
          // v14 → v15: add hidden Kimi edit-agent preferences.
          result.kimiEditModel = result.kimiEditModel ?? '';
          result.kimiEditUseCos = result.kimiEditUseCos ?? true;
        }
        if (version <= 15) {
          // v15 → v16: split compatible image API slots by use case and price tier.
          if (Array.isArray(result.imageApiSlots)) {
            result.imageApiSlots = result.imageApiSlots.map((s: any) => ({
              ...s,
              mode: s.mode ?? 'text-to-image',
              tier: s.tier ?? 'standard',
            }));
          }
        }
        if (version <= 16) {
          // v16 → v17: add doubaoSpeechApiKey for Doubao Speech (openspeech) API
          result.doubaoSpeechApiKey = result.doubaoSpeechApiKey ?? '';
        }
        if (version <= 17) {
          // v17 → v18: aihubmix.com 大陆不可达，迁移到备用域名
          if (Array.isArray(result.imageApiSlots)) {
            result.imageApiSlots = result.imageApiSlots.map((s: any) => {
              if (s.baseUrl?.includes('aihubmix.com')) {
                return { ...s, baseUrl: s.baseUrl.replace('aihubmix.com', 'api.inferera.com') };
              }
              return s;
            });
          }
        }
        if (version <= 18) {
          // v18 → v19: add Gemini Omni / APIMart MG animation provider settings.
          result.omniApiKey = result.omniApiKey ?? '';
          result.omniBaseUrl = result.omniBaseUrl ?? OMNI_DEFAULT_BASE_URL;
          result.omniFallbackBaseUrls = Array.isArray(result.omniFallbackBaseUrls)
            ? result.omniFallbackBaseUrls
            : OMNI_DEFAULT_FALLBACK_BASE_URLS;
          result.omniCreditPricePer10 = result.omniCreditPricePer10 ?? OMNI_DEFAULT_CREDIT_PRICE_PER_10;
        }
        if (version <= 19) {
          // v19 → v20: add ZexAPI as a low-cost global image provider.
          if (Array.isArray(result.imageApiSlots)) {
            result.imageApiSlots = result.imageApiSlots.map((s: any) => {
              if (s.provider === 'zexapi') {
                return { ...s, baseUrl: IMAGE_PROVIDERS.zexapi.baseUrl, label: s.label || IMAGE_PROVIDERS.zexapi.label };
              }
              return s;
            });
          }
        }
        if (version <= 20) {
          // v20 → v21: add ZeroFall Omni key for omni-flash-vref route.
          result.omniZeroFallApiKey = result.omniZeroFallApiKey ?? '';
        }
        if (version <= 21) {
          // v21 → v22: split APIMart-compatible fallback key from the ZexAPI key.
          result.omniApimartApiKey = result.omniApimartApiKey ?? result.omniApiKey ?? '';
        }
        if (version <= 22) delete result.lastContextMemoryPath;
        if (version <= 23) {
          result.chatImageModel = result.chatImageModel ?? 'gpt-image-2';
          result.chatVideoModel = result.chatVideoModel ?? 'seedance-2.0';
        }
        if (version <= 24) {
          result.workspaceAgentModels = {
            canvas: 'global',
            workshop: 'global',
            editor: 'global',
            ...(result.workspaceAgentModels ?? {}),
          };
        }
        if (version <= 25) {
          // v25 → v26: add speechKuaiziFirst（配音默认走筷子丽帧 seed_audio 通道）
          result.speechKuaiziFirst = result.speechKuaiziFirst ?? true;
        }
        if (version <= 26) {
          // v26 -> v27: DeepSeek main Agent defaults to official Harness.
          delete result.deepseekEngine;
        }
        if (version <= 28) {
          // v28 -> v29: all four APIMart gateways participate in dynamic
          // health selection. A transient timeout must not retire a domain.
          result.omniBaseUrl = result.omniBaseUrl || OMNI_DEFAULT_BASE_URL;
          const fallbacks = Array.isArray(result.omniFallbackBaseUrls)
            ? result.omniFallbackBaseUrls
            : [];
          result.omniFallbackBaseUrls = [...new Set([
            ...fallbacks,
            ...OMNI_DEFAULT_FALLBACK_BASE_URLS,
          ])];
        }
        if (version <= 29) {
          // v29 → v30: 凭证注册表。把旧平铺 key 字段「复制」归并进 credentials
          // （同 baseUrl+key 合并为一条），并记录各能力的 credentialId 引用。
          // 安全约束：旧字段一律保留原值作 resolver 回退，绝不在此清空。
          const migrated = migrateLegacyCredentials(result);
          result.credentials = migrated.credentials;
          result.credentialRefs = migrated.credentialRefs;
          if (migrated.imageApiSlots) result.imageApiSlots = migrated.imageApiSlots;
        }
        if (version <= 30) {
          // v30 → v31: Seedance 2.0 通道从布尔开关升级为引擎选择，
          // 保留老用户的原选择；MiniMax H3 渠道偏好默认自动容灾。
          result.seedanceEngine = result.seedanceEngine
            ?? (result.useRhtvSeedance ? 'runninghub' : 'kuaizi');
          result.minimaxH3Channel = result.minimaxH3Channel ?? 'auto';
        }
        if (version <= 32) {
          result.customVideoBaseUrl = result.customVideoBaseUrl ?? 'http://127.0.0.1:8000';
          result.customVideoApiKey = result.customVideoApiKey ?? '';
          result.customVideoModel = result.customVideoModel ?? '';
          result.customVideoCreatePath = result.customVideoCreatePath ?? '/v1/videos';
          result.customVideoStatusPath = result.customVideoStatusPath ?? '/v1/videos/{id}';
          result.customVideoProvider = result.customVideoProvider ?? 'vllm-omni';
          result.customVideoApiBaseUrl = result.customVideoApiBaseUrl ?? '';
          result.customVideoNativeApiKey = result.customVideoNativeApiKey ?? '';
          result.customVideoApiModel = result.customVideoApiModel ?? '';
        }
        if (version <= 33) {
          result.customVideoGenericBaseUrl = result.customVideoGenericBaseUrl ?? '';
          result.customVideoGenericApiKey = result.customVideoGenericApiKey ?? '';
          result.customVideoGenericCreatePath = result.customVideoGenericCreatePath ?? '/v1/generations';
          result.customVideoGenericStatusPath = result.customVideoGenericStatusPath ?? '/v1/generations/{id}';
          result.customVideoGenericProtocol = result.customVideoGenericProtocol ?? 'ltx-json';
          result.customVideoGenericModel = result.customVideoGenericModel ?? '';
        }
        if (version <= 34) {
          result.customVideoGenericH3Task = result.customVideoGenericH3Task ?? 'ref2va';
          result.customVideoGenericH3ShortEdge = result.customVideoGenericH3ShortEdge ?? '768';
          result.customVideoGenericH3AspectRatio = result.customVideoGenericH3AspectRatio ?? 'auto';
          result.customVideoGenericH3Quality = result.customVideoGenericH3Quality ?? 'lossless';
          result.customVideoGenericH3NumOutputs = result.customVideoGenericH3NumOutputs ?? '1';
          result.customVideoGenericH3InferenceSteps = result.customVideoGenericH3InferenceSteps ?? '8';
          result.customVideoGenericH3FlowShift = result.customVideoGenericH3FlowShift ?? '12';
          result.customVideoGenericH3AudioFlowShift = result.customVideoGenericH3AudioFlowShift ?? '3';
          result.customVideoGenericH3Seed = result.customVideoGenericH3Seed ?? '3104';
        }
        if (version <= 35) {
          delete result.customVideoGenericReferenceMode;
          delete result.customVideoGenericServerPathPrefix;
          delete result.customVideoGenericReferenceUri;
        }
        if (version <= 36) {
          // v36 → v37: 为旧版本补齐 H3 配置；下一迁移会把历史内置地址统一到 7863。
          const genericBaseWasEmpty = !String(result.customVideoGenericBaseUrl ?? '').trim();
          result.customVideoGenericBaseUrl = result.customVideoGenericBaseUrl || MINIMAX_H3_DEFAULT_ENDPOINT;
          if (genericBaseWasEmpty) {
            result.customVideoGenericProtocol = 'sglang-h3';
            result.customVideoGenericCreatePath = '/v1/videos';
            result.customVideoGenericStatusPath = '/v1/videos/{id}';
            result.customVideoGenericModel = 'MiniMaxAI/MiniMax-H3';
          }
        }
        if (version <= 37) {
          // v37 → v38: 本次验收切换到 7863；
          // 只迁移此前写入的内置默认值，不覆盖用户自己的私有部署设置。
          if (isLegacyMinimaxH3Endpoint(result.customVideoGenericBaseUrl)) {
            result.customVideoGenericBaseUrl = MINIMAX_H3_DEFAULT_ENDPOINT;
          }
          if (isLegacyMinimaxH3Endpoint(result.customVideoBaseUrl)) {
            result.customVideoBaseUrl = MINIMAX_H3_DEFAULT_ENDPOINT;
          }
        }
        if (version <= 38) {
          // v38 → v39: 预置的 H3 私有服务固定走 7863，避免 Base URL 已更新但
          // 自动选路仍把请求发送到其他渠道；用户明确配置其他 H3 渠道时不覆盖。
          if (
            result.minimaxH3Channel === 'auto'
            && result.customVideoGenericBaseUrl === MINIMAX_H3_DEFAULT_ENDPOINT
            && result.customVideoGenericProtocol === 'sglang-h3'
          ) {
            result.minimaxH3Channel = 'custom';
          }
        }
        if (version <= 39) {
          // v39 → v40: 7863 是 SGLang MiniMax-H3 服务，必须使用通用 JSON
          // Provider；否则旧配置会保持 vLLM-Omni，H3 自定义通道不会被识别。
          if (
            result.customVideoGenericBaseUrl === MINIMAX_H3_DEFAULT_ENDPOINT
            && result.customVideoGenericProtocol === 'sglang-h3'
          ) {
            result.customVideoProvider = 'generic-api';
            result.minimaxH3Channel = 'custom';
          }
        }
        if (version <= 40) {
          // v40 → v41: v40 曾把内置 H3 默认推理步数误写成 4，恢复为
          // 7863 fl2va 服务示例的 50；只有命中内置 7863 服务和旧默认值时才迁移。
          if (
            result.customVideoGenericBaseUrl === MINIMAX_H3_DEFAULT_ENDPOINT
            && result.customVideoGenericProtocol === 'sglang-h3'
            && result.customVideoGenericH3InferenceSteps === '4'
          ) {
            result.customVideoGenericH3InferenceSteps = '50';
          }
        }
        if (version <= 44) {
          // v44 → v45: align the built-in MiniMax-H3 ref2va defaults with the
          // deployed reference-mode profile (8 steps, seed 3104). Only migrate
          // the old untouched pair; preserve explicit user overrides.
          if (
            result.customVideoGenericBaseUrl === MINIMAX_H3_DEFAULT_ENDPOINT
            && result.customVideoGenericProtocol === 'sglang-h3'
            && result.customVideoGenericH3InferenceSteps === '50'
            && result.customVideoGenericH3Seed === '3101'
          ) {
            result.customVideoGenericH3InferenceSteps = '8';
            result.customVideoGenericH3Seed = '3104';
          }
        }
        if (version <= 41) {
          result.qualityReviewEnabled = result.qualityReviewEnabled ?? true;
          result.qualityReviewBaseUrl = result.qualityReviewBaseUrl ?? 'http://127.0.0.1:30377';
          result.qualityReviewModel = result.qualityReviewModel ?? 'qwen3.8-27b';
          result.qualityReviewMaxFrameAttempts = Math.max(1, Math.min(3, Number(result.qualityReviewMaxFrameAttempts) || 3));
        }
        if (version <= 42 && result.qualityReviewBaseUrl === 'http://127.0.0.1:30377') {
          result.qualityReviewBaseUrl = 'http://127.0.0.1:30377';
        }
        if (version <= 43) {
          result.qualityReviewEnabled = false;
        }
        if (version <= 31) {
          // v31 → v32: DeepSeek 默认模型切换为官方视觉模型
          // deepseek-v4-flash-vision-exp（2026-08-21 上线，原生识图默认开启）。
          // 按产品决策覆盖此前的任何 DeepSeek 模型选择。
          result.providerModels = result.providerModels ?? {};
          result.providerModels.deepseek = 'deepseek-v4-flash-vision-exp';
        }
        // Tier 4 seeds (idempotent)
        result.arkModelsCache = result.arkModelsCache ?? null;
        result.outputStyle = result.outputStyle ?? 'default';
        result.notificationsEnabled = result.notificationsEnabled ?? true;
        result.webSearchEnabled = result.webSearchEnabled ?? false;
        delete result.deepseekEngine;
        delete result.maxTurns;
        delete result.setMaxTurns;
        result.chatImageModel = result.chatImageModel ?? 'gpt-image-2';
        result.chatVideoModel = result.chatVideoModel ?? 'seedance-2.0';
        result.qualityReviewEnabled = result.qualityReviewEnabled ?? false;
        result.qualityReviewBaseUrl = result.qualityReviewBaseUrl ?? 'http://127.0.0.1:30377';
        result.qualityReviewModel = result.qualityReviewModel ?? 'qwen3.8-27b';
        result.qualityReviewMaxFrameAttempts = Math.max(1, Math.min(3, Number(result.qualityReviewMaxFrameAttempts) || 3));
        result.wan3Channel = result.wan3Channel ?? 'auto';
        result.workspaceAgentModels = {
          canvas: 'global',
          workshop: 'global',
          editor: 'global',
          ...(result.workspaceAgentModels ?? {}),
        };
        result.omniApiKey = result.omniApiKey ?? '';
        result.omniZeroFallApiKey = result.omniZeroFallApiKey ?? '';
        result.omniApimartApiKey = result.omniApimartApiKey ?? '';
        delete result.dmxUsageUserId;
        result.omniBaseUrl = result.omniBaseUrl ?? OMNI_DEFAULT_BASE_URL;
        result.omniFallbackBaseUrls = Array.isArray(result.omniFallbackBaseUrls)
          ? result.omniFallbackBaseUrls
          : OMNI_DEFAULT_FALLBACK_BASE_URLS;
        result.omniCreditPricePer10 = result.omniCreditPricePer10 ?? OMNI_DEFAULT_CREDIT_PRICE_PER_10;
        const legacyGenericEndpoint = isLegacyMinimaxH3Endpoint(result.customVideoGenericBaseUrl);
        const legacyCustomEndpoint = isLegacyMinimaxH3Endpoint(result.customVideoBaseUrl);
        if (legacyGenericEndpoint) {
          result.customVideoGenericBaseUrl = migrateMinimaxH3Endpoint(result.customVideoGenericBaseUrl);
        }
        if (legacyCustomEndpoint) {
          result.customVideoBaseUrl = migrateMinimaxH3Endpoint(result.customVideoBaseUrl);
        }
        if (legacyGenericEndpoint || legacyCustomEndpoint) {
          result.customVideoProvider = 'generic-api';
          result.customVideoGenericProtocol = 'sglang-h3';
          result.customVideoGenericCreatePath = '/v1/videos';
          result.customVideoGenericStatusPath = '/v1/videos/{id}';
          result.customVideoGenericModel = 'MiniMaxAI/MiniMax-H3';
          result.minimaxH3Channel = 'custom';
        }
        return result;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const legacyGeneric = isLegacyMinimaxH3Endpoint(state.customVideoGenericBaseUrl);
        const legacyCustom = isLegacyMinimaxH3Endpoint(state.customVideoBaseUrl);
        if (!legacyGeneric && !legacyCustom) return;
        useSettingsStore.setState({
          customVideoGenericBaseUrl: MINIMAX_H3_DEFAULT_ENDPOINT,
          customVideoGenericProtocol: 'sglang-h3',
          customVideoGenericCreatePath: '/v1/videos',
          customVideoGenericStatusPath: '/v1/videos/{id}',
          customVideoGenericModel: 'MiniMaxAI/MiniMax-H3',
          customVideoProvider: 'generic-api' as const,
          minimaxH3Channel: 'custom' as const,
          ...(legacyCustom ? { customVideoBaseUrl: MINIMAX_H3_DEFAULT_ENDPOINT } : {}),
        });
      },
    }
  )
);
