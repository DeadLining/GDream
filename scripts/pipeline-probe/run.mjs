/**
 * GDream工坊流水线 · 模块化实测
 *
 * 用桌面应用**同源**的提示词、工具 schema 与校验器，直连本地推理服务，
 * 逐个模块跑真实请求，定位「剧本生成 / 拆解」卡在哪一层。
 *
 * 与单轮探针的区别：这里实现了**多轮工具回灌循环**，并用桩执行器返回与
 * 应用一致的 tool 结果（含真实校验器的报错文案），以复现 Agent 的真实行为。
 *
 * 用法：
 *   PROBE_KEY=sk-xxx node run.mjs all
 *   PROBE_KEY=sk-xxx node run.mjs breakdown script
 *   PROBE_BASE / PROBE_MODEL / PROBE_TURNS 可覆盖默认值
 *
 * 注意：密钥只从环境变量读取，不写文件、不进日志。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installShims } from './preload.mjs';

installShims();

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.PROBE_BASE || 'http://127.0.0.1:30377').replace(/\/+$/, '');
const KEY = process.env.PROBE_KEY || '';
const MODEL = process.env.PROBE_MODEL || 'deepseek-v4-flash-0731';
const CALL_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 180_000);
const MAX_TURNS = Number(process.env.PROBE_TURNS || 8);
// 与桌面应用 glmClient.ts:98-99 完全一致的两道流式看门狗。
// 探针用它们，才能报出**用户实际会看到的那句话**，而不是探针自造的 420s 超时。
const FIRST_EVENT_MS = Number(process.env.PROBE_FIRST_EVENT_MS || 120_000);
const IDLE_EVENT_MS = Number(process.env.PROBE_IDLE_EVENT_MS || 90_000);

const h = await import(pathToFileURL(path.join(here, '.gen/harness.mjs')).href);

// ── 还原应用运行期状态 ────────────────────────────────────────────────
h.useChatStore.setState({ activeView: 'workshop' });
h.useSettingsStore.setState({ webSearchEnabled: false });

const registry = h.createDefaultRegistry();
const defs = registry.getDefinitions();

const SYSTEM_PROMPT = h.buildSystemPrompt({
  // 用脚本自身位置推导仓库根，避免把开发者本地绝对路径写死进仓库。
  cwd: path.resolve(here, '../..'),
  os: 'darwin',
  shell: '/bin/zsh',
  outputStyle: 'default',
  primaryProviderId: 'custom',
});

const IDEA = '全班穿越孤岛，随机道具生存';
const SPEC = {
  format: 'short-series',
  episodeCount: 1,
  episodeDurationSec: 90,
  detailLevel: 'detailed',
  expansionPolicy: 'balanced',
  allowNewCharacters: true,
  allowSubplots: false,
  allowNewConflicts: true,
};

// ── 工具包装（照抄 deepseek.ts:convertToolsForOpenAI）──────────────────
function toOpenAITools(list) {
  if (!list?.length) return undefined;
  return list.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** 把拆解工具的 required 换成应用运行期真正会下发的值。 */
function withResolvedRequired(list, toolName, required) {
  return list.map((d) => (d.name === toolName ? { ...d, parameters: { ...d.parameters, required } } : d));
}

// ── 流式请求 ─────────────────────────────────────────────────────────
async function streamChat({ messages, tools, maxTokens = 16_000, timeoutMs }) {
  // 逐集剧本这类长输出任务，单轮耗时天然高于普通对话轮；
  // 用逐模块预算覆盖全局默认值，避免把「模型还在写」误判成服务故障。
  const budget = Number(timeoutMs) > 0 ? Number(timeoutMs) : CALL_TIMEOUT_MS;
  const body = { model: MODEL, messages, max_tokens: maxTokens, temperature: 0.7, stream: true };
  const openaiTools = toOpenAITools(tools);
  if (openaiTools) body.tools = openaiTools;

  const ac = new AbortController();
  // 两级看门狗 + 一个兜底硬预算：
  //   首包 120s / 空闲 90s 是应用真实阈值；硬预算兜住「一直有数据但不结束」。
  let watchdogFired = null;
  let watchdogTimer = null;
  const armWatchdog = (ms, phase) => {
    clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => { watchdogFired = phase; ac.abort(); }, ms);
  };
  const hardTimer = setTimeout(() => { watchdogFired = '硬预算'; ac.abort(); }, budget);
  armWatchdog(FIRST_EVENT_MS, '首包');
  const t0 = Date.now();
  let firstByteMs = null;
  let firstContentMs = null;
  let text = '';
  let reasoningChars = 0;
  const toolCalls = new Map();
  let finishReason = null;
  let usage = null;
  let error = null;
  let httpStatus = null;

  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    httpStatus = res.status;
    if (!res.ok) {
      error = `HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`;
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstByteMs === null) firstByteMs = Date.now() - t0;
        armWatchdog(IDLE_EVENT_MS, '空闲');
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let d;
            try { d = JSON.parse(payload); } catch { continue; }
            if (d.usage) usage = d.usage;
            const ch = d.choices?.[0];
            if (!ch) continue;
            if (ch.finish_reason) finishReason = ch.finish_reason;
            const delta = ch.delta || {};
            if (delta.content) {
              if (firstContentMs === null) firstContentMs = Date.now() - t0;
              text += delta.content;
            }
            if (delta.reasoning_content) reasoningChars += delta.reasoning_content.length;
            for (const tc of delta.tool_calls || []) {
              const idx = tc.index ?? 0;
              const cur = toolCalls.get(idx) || { id: '', name: '', args: '' };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.name = tc.function.name;
              if (tc.function?.arguments) cur.args += tc.function.arguments;
              toolCalls.set(idx, cur);
            }
          }
        }
      }
    }
  } catch (e) {
    error = e.name === 'AbortError'
      ? watchdogFired === '首包' ? `模型流式响应首包超时（${FIRST_EVENT_MS / 1000} 秒无数据）`
        : watchdogFired === '空闲' ? `模型流式响应空闲超时（${IDLE_EVENT_MS / 1000} 秒无数据）`
          : `超时中断（${budget}ms）`
      : String(e.message || e);
  } finally {
    clearTimeout(hardTimer);
    clearTimeout(watchdogTimer);
  }

  return {
    httpStatus,
    totalMs: Date.now() - t0,
    firstByteMs,
    firstContentMs,
    text,
    textChars: text.length,
    reasoningChars,
    finishReason,
    usage,
    requestChars: JSON.stringify(body).length,
    error,
    toolCalls: [...toolCalls.values()].map((c) => {
      let args = null;
      let parseError = null;
      try { args = JSON.parse(c.args || '{}'); } catch (e) { parseError = String(e.message); }
      return { id: c.id, name: c.name, argChars: c.args.length, args, parseError };
    }),
  };
}

// ── 桩执行器：返回与桌面应用一致的工具结果 ────────────────────────────
// 只读工坊工具集合与重复写入刹车都**直接使用产品实现**
// （`src/lib/agent/workshopWriteGuard.ts`，经 entry.ts 导出），不再自己复制一份。
// 旧版探针自持一份集合 + 用 stableToolParams 近似产品的 JSON.stringify，
// 使「探针报刹车」不等于「产品会刹车」（缺陷 F17）。

/**
 * 关键点：拆解工具用**应用真实的 validateBreakdownInput** 判定，
 * 失败时回灌的文案与应用 workshopTools.ts 一致，模型看到的反馈是同源的。
 */
function makeStubExecutor(options = {}) {
  const state = {
    breakdownAttempts: [],
    writeGuard: new h.WorkshopWriteGuard(),
    duplicateTerminated: false,
    scriptCommitted: false,
    shotsCommitted: false,
    reviewSaved: null,
    gateBlocked: null,
    episodeScriptAttempts: [],
    shortCircuitLog: [],
    // ③资产提示词 / ④分镜提示词：记录每次写入，用于判定模型有没有真的落库。
    assetPromptAttempts: [],
    promptBatches: [],
  };
  // 部分模块（例如按步下发的第 1 步）会先校验项目里有没有剧本源文件。
  // 不注入源文件时守卫会正确地停手，那样测的就不是产品行为而是探针的缺省状态。
  const sourceFiles = options.sourceFiles ?? [];
  const hasSource = sourceFiles.length > 0;
  // 有源文件的项目在应用里会冻结一个剧本 revision，拆解前必须先过 Draft Review。
  const scriptRevisionId = options.scriptRevisionId ?? null;
  // 逐集剧本写入要求目标分集已存在（workshopTools.ts:1419）。
  const episodes = options.episodes ?? [];
  const hasExistingBreakdown = options.hasExistingBreakdown ?? episodes.length > 0;
  // ③④步的种子素材：提示词任务是「为已有角色/场景/分镜写提示词」，
  // 不给素材的话模型无事可做，测到的是探针缺省状态而不是提示词形态。
  const characters = options.characters ?? [];
  const scenes = options.scenes ?? [];
  const shots = options.shots ?? [];
  const hasAssets = characters.length > 0 || scenes.length > 0;
  const allAssetIds = new Set([...characters, ...scenes].map((a) => String(a.id)));

  const execTool = async (call) => {
    const { name, args } = call;
    // 重复写入刹车：与 coordinator 共用 WorkshopWriteGuard，语义完全一致。
    // 「重复」的前提是**状态没变**——任何成功的工坊写入都会推进世代并清空计数，
    // 因此「先修前置状态、再重提同一载荷」不会被误杀（缺陷 F15）。
    state.writeGuard.record(name, args ?? {});
    if (state.writeGuard.isDuplicate(name, args ?? {})) {
      state.duplicateTerminated = true;
      return {
        success: false,
        output: '',
        error: h.duplicateWriteNotice(name),
        terminal: true,
      };
    }

    switch (name) {
      case 'workshop_get_state': {
        const base = {
          open: true,
          project: { id: 'probe-project', name: '短剧项目 9-14' },
          currentStep: hasSource ? 'breakdown' : 'script',
          steps: {
            script: { status: hasSource ? 'done' : 'pending' },
            breakdown: { status: hasExistingBreakdown ? 'in-progress' : 'pending' },
            assets: { status: 'pending' }, prompts: { status: 'pending' },
            generate: { status: 'pending' }, handoff: { status: 'pending' },
          },
          hasSynopsis: hasExistingBreakdown || hasAssets,
          episodeCount: episodes.length,
          beatCount: 0,
          characterCount: characters.length,
          sceneCount: scenes.length,
          shotCount: shots.length,
          sources: sourceFiles.map((f) => f.name),
        };
        // 与真实工具一致：只有 detail="step" 才带出剧本版本与审核凭据。
        if (args?.detail === 'step') {
          const refs = probeRefBindings();
          const refOrder = refs.map((r) => `${r.ref}=${r.label}`);
          return { success: true, output: JSON.stringify({
            ...base,
            currentScriptRevisionId: scriptRevisionId ?? undefined,
            currentScriptRevision: scriptRevisionId ? { id: scriptRevisionId, label: '源剧本' } : undefined,
            scriptReview: state.reviewSaved ?? undefined,
            episodes: episodes.map((e) => ({ no: e.no, title: e.title })),
            // ④步必须知道视频模型与模板，否则无法判断要不要套 H3 八段结构、
            // 能不能在 videoPrompt 里写 @图片N。
            videoModel: PROBE_VIDEO_MODEL,
            videoPromptTemplate: 'legacy',
            h3Task: null,
            bibles: PROBE_BIBLES,
            qualityLearning: PROBE_QUALITY_LEARNING,
            props: [],
            colorPalettes: [],
            globalColorPaletteId: null,
            // ③步的提示词要求「先 get_state(detail:"step") 查看角色/场景档案」，
            // 这里必须真的返回档案，否则模型无从下笔。
            characters: characters.length ? characters : undefined,
            scenes: scenes.length ? scenes : undefined,
            shots: shots.length
              ? shots.map((s) => ({
                ...s,
                // 与真实工具一致：状态里带 referenceSignature，模型只有签名缺失/过期时
                // 才需要调 workshop_get_shot_refs。这里给稳定签名，避免无谓的额外往返。
                referenceSignature: s.referenceSignature ?? `probe-sig-${s.shotNo}`,
                imageReferenceOrder: refOrder,
                videoReferenceOrder: refOrder,
                imageReferenceBindings: refs,
                videoReferenceBindings: refs,
                sceneReferenceCount: PROBE_SCENES.length,
                // 空提示词 + 无 actionTimeline，正是第④步该补的东西。
                imagePromptLength: 0,
                videoPromptLength: 0,
                directorConstraintCard: null,
              }))
              : undefined,
          }) };
        }
        return { success: true, output: JSON.stringify(base) };
      }

      case 'workshop_read_source':
        // 与真实工具一致：只返回绝对路径，不返回正文（workshopTools.ts:1039）。
        // 模型必须再用 read_file 读正文，所以桩执行器必须实现 read_file，否则
        // 测到的是「探针没有读文件能力」而不是产品行为。
        return { success: true, output: JSON.stringify({
          files: sourceFiles.map((f) => f.path),
        }) };

      case 'read_file': {
        const target = String(args?.path ?? args?.file_path ?? '').trim();
        const hit = sourceFiles.find((f) => f.path === target || f.name === path.basename(target));
        if (!hit) return { success: false, output: '', error: `找不到文件：${target}`, recoverable: true };
        return { success: true, output: String(hit.content ?? '') };
      }

      case 'bash': {
        const cmd = String(args?.command ?? '').trim();
        // 只支持读剧本这一种用法；其它命令按「探针未实现」返回，避免掩盖真实探索行为。
        const m = /^(?:cat|head|tail|sed -n .*?)\s+(.+)$/.exec(cmd) || /^cat\s+(.+)$/.exec(cmd);
        if (m) {
          const target = m[1].replace(/^['"]|['"]$/g, '').trim();
          const hit = sourceFiles.find((f) => f.path === target || f.name === path.basename(target));
          if (hit) return { success: true, output: String(hit.content ?? '') };
        }
        return { success: false, output: '', error: `probe 桩执行器只实现读取剧本源文件的 bash 命令，收到：${cmd.slice(0, 80)}`, recoverable: true };
      }

      case 'workshop_set_script_review': {
        // 与 workshopTools.ts:1072 一致：revision_id 必须等于当前剧本版本。
        const revisionId = String(args?.revision_id ?? '').trim();
        if (scriptRevisionId && revisionId !== scriptRevisionId) {
          state.gateBlocked = 'revision_id-mismatch';
          return { success: false, output: '', error: `revision_id 与当前剧本版本不一致，请传入 workshop_get_state 返回的 currentScriptRevisionId（${scriptRevisionId}）。`, recoverable: true };
        }
        const passed = String(args?.status ?? 'passed') !== 'needs-repair';
        state.reviewSaved = { revisionId, status: passed ? 'passed' : 'needs-repair' };
        return { success: true, output: `剧本 Draft Review 已保存：${passed ? '通过' : '需要修订'}。` };
      }

      case 'workshop_set_episode_script': {
        const episodeNo = String(args?.episode_no ?? '').trim();
        const script = String(args?.script ?? '').trim();
        state.episodeScriptAttempts.push({ episodeNo, scriptChars: script.length });
        if (!episodeNo || !script) return { success: false, output: '', error: 'episode_no 和 script 不能为空。' };
        if (episodes.length > 0 && !episodes.some((e) => String(e.no) === episodeNo)) {
          return { success: false, output: '', error: `未找到第 ${episodeNo} 集，请先写入分集季纲。` };
        }
        state.scriptCommitted = true;
        return { success: true, output: `第 ${episodeNo} 集详细剧本已保存（draft），可进入本集分镜拆解。` };
      }

      case 'workshop_set_breakdown': {
        // 门 1：有源文件且已冻结剧本版本时，必须先通过 Draft Review（workshopTools.ts:1266）。
        if (hasSource && scriptRevisionId) {
          const review = state.reviewSaved;
          if (!review || review.revisionId !== scriptRevisionId || review.status !== 'passed') {
            state.gateBlocked = 'review-required';
            return {
              success: false, output: '',
              error: '当前剧本尚未通过 Draft Review，不能进入拆解。请先读取剧本并调用 workshop_set_script_review；只有 status="passed" 才能继续。',
              recoverable: true,
            };
          }
        }
        // 门 2：首次拆解 + 有源文件时必须附 3-12 条逐字 sourceEvidence（workshopTools.ts:1276）。
        const evidence = Array.isArray(args?.sourceEvidence)
          ? [...new Set(args.sourceEvidence.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))]
          : [];
        if (!hasExistingBreakdown && hasSource && (evidence.length < 3 || evidence.length > 12)) {
          state.gateBlocked = 'source-evidence';
          return {
            success: false, output: '',
            error: '首次剧本拆解必须提交 3-12 条 sourceEvidence，逐字摘录剧本中能证明主要人物、关系和事件的短句。电影化表达可以丰富，但故事事实必须先有原文收据。',
            recoverable: true,
          };
        }
        const errors = h.breakdownValidation.validateBreakdownInput(args ?? {}, true);
        state.breakdownAttempts.push({ args, errors, evidence: evidence.length });
        if (errors.length === 0) {
          return { success: true, output: `拆解结果已写入工坊（梗概/分集/角色/场景）${evidence.length ? `，并保存 ${evidence.length} 条原文证据` : ''}，UI 已更新。` };
        }
        const missing = ['episodes', 'narrativeBeats', 'characters', 'scenes'].filter((k) => {
          const v = args?.[k];
          return v === undefined || (Array.isArray(v) && v.length === 0);
        });
        const message = !args?.synopsis
          ? `拆解校验未通过：${errors.slice(0, 4).join('；')}`
          : missing.length > 0
            ? `首次拆解不能只写梗概，缺少结构化字段：${missing.join('、')}。请按 Scene → Narrative Beat → 角色/场景一次性提交；不要跳过中间层。`
            : `拆解校验未通过：${errors.slice(0, 4).join('；')}`;
        return { success: false, output: '', error: message, recoverable: true };
      }

      case 'workshop_set_shots':
        state.shotsCommitted = true;
        return { success: true, output: `分镜表已写入（${Array.isArray(args?.shots) ? args.shots.length : 0} 镜）。` };

      case 'workshop_set_bibles':
        return { success: true, output: '项目四圣经已写入。' };

      case 'workshop_set_asset_prompt': {
        // 保真对齐 workshopTools.ts（F12 修复后）：
        // 真实实现先确认资产存在（store 层 map 不命中即静默 no-op，所以必须在工具层拦住），
        // 不存在时返回 success=false；缺 mjPrompt 不失败，但 output 里必须带出缺口提示。
        const kind = String(args?.kind ?? '').trim();
        const id = String(args?.id ?? '').trim();
        const prompt = String(args?.prompt ?? '').trim();
        const mjPrompt = String(args?.mjPrompt ?? args?.mj_prompt ?? '').trim();
        const known = allAssetIds.has(id);
        state.assetPromptAttempts.push({
          kind, id, known,
          promptChars: prompt.length,
          mjPromptChars: mjPrompt.length,
          ...checkAssetContent(kind, prompt, mjPrompt),
        });
        if (!kind || !id || !prompt) {
          return { success: false, output: '', error: 'kind、id、prompt 都不能为空。', recoverable: true };
        }
        if (!known) {
          state.assetPromptUnknownId = (state.assetPromptUnknownId || 0) + 1;
          return {
            success: false, output: '',
            error: `未找到资产：${kind} ${id}。请先用 workshop_get_state 读取当前项目的真实资产 id，不要凭记忆或推测填写。`,
            recoverable: true,
          };
        }
        if (!mjPrompt) state.assetPromptMissingMj = (state.assetPromptMissingMj || 0) + 1;
        const missingMj = mjPrompt ? '' : '；⚠ 未提供 mjPrompt，Midjourney 通道将没有可用提示词，请补写英文版';
        return { success: true, output: `${kind} ${id} 提示词已设置${mjPrompt ? '（含 MJ 英文版）' : ''}${missingMj}` };
      }

      case 'workshop_set_prompts': {
        // 与 workshopTools.ts:2373 一致：参数是 { items: [...] }，未知 shotNo 只告警不致命。
        const items = Array.isArray(args?.items) ? args.items : null;
        if (!items) {
          state.promptBatches.push({ error: 'items-not-array' });
          return {
            success: false, output: '',
            error: 'workshop_set_prompts 参数错误：items 必须是数组。请用 { items: [{ shotNo, imagePrompt, videoPrompt }] } 调用。',
            recoverable: true,
          };
        }
        const knownShotNos = new Set(shots.map((s) => String(s.shotNo)));
        const usable = items.filter((it) => it && String(it.shotNo ?? '').trim() && knownShotNos.has(String(it.shotNo).trim()));
        const unknown = items.map((it) => String(it?.shotNo ?? '').trim()).filter((n) => n && !knownShotNos.has(n));
        const withVideo = usable.filter((it) => String(it.videoPrompt ?? '').trim());
        const withImage = usable.filter((it) => String(it.imagePrompt ?? '').trim());
        // 真实实现的致命门禁（workshopTools.ts:2537）：原子镜头 Reviewer 未过时禁止写 videoPrompt。
        // 桩此前没复现这条，属于「桩比产品宽松」——会让④的通过率虚高。
        const planningBlocked = usable.filter((it) => {
          if (it.videoPrompt === undefined) return false;
          const shot = shots.find((s) => String(s.shotNo) === String(it.shotNo).trim());
          return shot?.planningReview?.status === 'needs-repair';
        });
        if (planningBlocked.length > 0) {
          state.promptBatches.push({ error: 'planning-review-blocked', shotNos: planningBlocked.map((it) => String(it.shotNo)) });
          return {
            success: false, output: '',
            error: planningBlocked
              .map((it) => `${String(it.shotNo).trim()}: 原子镜头 Reviewer 未通过，请先最小修复或拆镜，再写视频提示词`)
              .join('\n'),
            recoverable: true,
          };
        }
        // 真实实现还有两条致命门禁，桩此前没复现（=桩比产品宽松 → ④通过率可能虚高）：
        //   1. expectedRefSignature 与当前签名不符（workshopTools.ts:2547）
        //   2. 提示词写了本镜未关联的角色名（workshopTools.ts:2592-2600，经 collectUnlinkedCharacterWarnings）
        const staleSignature = usable.filter((it) => {
          const shotNo = String(it.shotNo).trim();
          return it.expectedRefSignature && it.expectedRefSignature !== `probe-sig-${shotNo}`;
        });
        if (staleSignature.length > 0) {
          state.promptBatches.push({ error: 'stale-ref-signature', shotNos: staleSignature.map((it) => String(it.shotNo)) });
          return {
            success: false, output: '',
            error: staleSignature
              .map((it) => `${String(it.shotNo).trim()}: 参考资产已在读取后发生变化。请重新调用 workshop_get_shot_refs，并按当前签名重写`)
              .join('\n'),
            recoverable: true,
          };
        }
        // 与 shotRefs.ts:35 effectiveOpeningCharacterIds 同源：关联角色由 description/entryState 反推，
        // 所以「本镜关联谁」不能只看 characterIds。
        const unlinkedHits = [];
        for (const it of usable) {
          const shotNo = String(it.shotNo).trim();
          const shot = shots.find((s) => String(s.shotNo) === shotNo);
          if (!shot) continue;
          const opening = [shot.entryState?.characters, shot.description].filter(Boolean).join(' ');
          const text = [it.imagePrompt, it.videoPrompt].filter((t) => typeof t === 'string').join('\n');
          if (!text) continue;
          const linkedIds = new Set([
            ...(shot.characterIds ?? []),
            ...characters.filter((c) => c.name && opening.includes(String(c.name))).map((c) => String(c.id)),
          ]);
          for (const c of characters) {
            if (c.name && text.includes(String(c.name)) && !linkedIds.has(String(c.id))) {
              unlinkedHits.push(`${shotNo}: 提示词写了角色“${c.name}”，但本镜 characterIds 未包含该角色`);
            }
          }
        }
        if (unlinkedHits.length > 0) {
          state.promptBatches.push({ error: 'unlinked-character' });
          return { success: false, output: '', error: unlinkedHits.join('\n'), recoverable: true };
        }
        // 结构判定：看模型真正写出来的 videoPrompt，而不是看提示词带了什么规则。
        const videoTexts = withVideo.map((it) => String(it.videoPrompt));
        // 导演级内容检查：**共用真实实现**（桩保真度缺陷 F18）。
        // 真实 workshop_set_prompts 会把 collectDirectorPromptWarnings() 的结果拼进回执，
        // 桩此前完全省略了这一块 → 探针看不到任何内容质量反馈，F10（④ 的 videoPrompt
        // 系统性偏短）只能靠人工分析留档参数才能发现，探针自己报不出来。
        // 口径：真实实现量的是「模型原文」（normalizePromptRefs 追加的约束块会被
        // stripGeneratedVideoBlocks 剥掉）；桩拿到的是模型刚提交的文本，本来就是原文，直接传入即可。
        const directorWarnings = [];
        for (const it of usable) {
          const shotNo = String(it.shotNo).trim();
          const shot = shots.find((s) => String(s.shotNo) === shotNo);
          if (!shot) continue;
          directorWarnings.push(...h.collectDirectorPromptWarnings(shot, it.imagePrompt, it.videoPrompt));
        }
        state.promptBatches.push({
          count: items.length,
          usable: usable.length,
          withVideo: withVideo.length,
          withImage: withImage.length,
          shotNos: usable.map((it) => String(it.shotNo).trim()),
          // 与产品同口径：textLen() 会去掉全部空白后再计长，这里不能只 trim()。
          avgVideoChars: withVideo.length
            ? Math.round(withVideo.reduce((n, it) => n + String(it.videoPrompt).replace(/\s+/g, '').length, 0) / withVideo.length)
            : 0,
          videoChars: withVideo.map((it) => String(it.videoPrompt).replace(/\s+/g, '').length),
          directorWarnings,
          unknown,
          universalSectionHits: UNIVERSAL_SECTION_HEADERS.filter((hdr) => videoTexts.some((t) => t.includes(hdr))),
          legacyHeaderCount: videoTexts.filter((t) => LEGACY_HEADER_RE.test(t)).length,
          // 完整原文留档：供「工具实现层回放」把模型的真实产出喂给真实 workshop_set_prompts，
          // 核对桩的放行是否等于产品的放行（事实锁/引用签名/角色关联等致命门禁都只在真实实现里）。
          rawItems: items.map((it) => ({
            shotNo: String(it?.shotNo ?? '').trim(),
            imagePrompt: typeof it?.imagePrompt === 'string' ? it.imagePrompt : undefined,
            videoPrompt: typeof it?.videoPrompt === 'string' ? it.videoPrompt : undefined,
          })),
        });
        if (usable.length === 0) {
          return { success: false, output: '', error: `items 里没有可写入的分镜：未找到对应分镜 ${unknown.join('、') || '（空）'}。`, recoverable: true };
        }
        // 回执格式与真实实现保持一致（workshopTools.ts:2745）。
        const warnBlock = directorWarnings.length
          ? `\n检查警告（提示词已经写入，本轮到此结束，不自动再次调用工具）：\n${directorWarnings.slice(0, 20).join('\n')}${directorWarnings.length > 20 ? `\n…还有 ${directorWarnings.length - 20} 条` : ''}`
          : '';
        return {
          success: true,
          output: `已写入 ${usable.length} 条分镜提示词（含 videoPrompt ${withVideo.length} 条、imagePrompt ${withImage.length} 条）${unknown.length ? `；跳过未找到的分镜：${unknown.join('、')}` : ''}。${warnBlock}`,
        };
      }

      case 'workshop_get_shot_refs': {
        const refs = probeRefBindings();
        return { success: true, output: JSON.stringify({
          shots: shots.map((s) => ({
            shotNo: s.shotNo,
            referenceSignature: `probe-sig-${s.shotNo}`,
            imageReferenceOrder: refs.map((r) => `${r.ref}=${r.label}`),
            videoReferenceOrder: refs.map((r) => `${r.ref}=${r.label}`),
            references: refs,
          })),
        }) };
      }

      case 'workshop_update_shot_refs':
        return { success: true, output: '分镜参考资产已更新。' };

      case 'workshop_get_production_audit':
        // ④步会用它核对交付前的引用/提示词状态；不实现会让模型把「探针缺能力」
        // 误当成项目状态缺失而拒绝写入（实测踩过）。
        return { success: true, output: JSON.stringify({
          projectId: 'probe-project',
          scriptRevision: scriptRevisionId ?? null,
          shots: shots.map((s) => ({
            shotNo: s.shotNo,
            continuity: 'ok',
            assetRefs: 'ok',
            prompt: 'missing',
            videoCandidate: 'none',
          })),
          issues: shots.map((s) => `${s.shotNo}: 缺少 imagePrompt / videoPrompt`),
        }, null, 2) };

      case 'workshop_set_step_status':
      case 'workshop_refresh_ui':
        return { success: true, output: 'ok' };

      default:
        return { success: false, output: '', error: `probe 未实现工具 ${name}（桩执行器）` };
    }
  };

  // 与应用 toolRegistry.execute() 同源的重复读取短路：
  // 同名同参数的只读工具、期间没有写入时，第二次起直接回「没有变化」。
  const repeatReads = new h.repeatReadGuard.RepeatReadMemo();
  const exec = async (call) => {
    const notice = repeatReads.check(call.name, call.args);
    if (notice) {
      state.shortCircuitLog.push(call.name);
      return { success: true, output: notice };
    }
    const result = await execTool(call);
    repeatReads.record(call.name, call.args, result.success === true);
    // 与 coordinator 同源：只有**成功**的工坊写入才推进「写入世代」。
    state.writeGuard.noteResult(call.name, result.success === true);
    return result;
  };

  return { exec, state };
}
/**
 * 多轮 Agent 循环：发请求 → 执行工具 → 回灌 → 继续。
 * 复现 coordinator 的核心节律，用于观察模型能否最终产出合法载荷。
 */
async function runAgentLoopOnce({ prompt, tools, options = {}, timeoutMs, maxTurns }) {
  const stub = makeStubExecutor(options);
  const turnBudget = Number(maxTurns) > 0 ? Number(maxTurns) : MAX_TURNS;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  const turns = [];
  let finalText = '';
  let terminatedBy = null;

  for (let turn = 0; turn < turnBudget; turn++) {
    const r = await streamChat({ messages, tools, timeoutMs });
    turns.push({
      turn: turn + 1,
      httpStatus: r.httpStatus,
      totalMs: r.totalMs,
      firstByteMs: r.firstByteMs,
      firstContentMs: r.firstContentMs,
      textChars: r.textChars,
      reasoningChars: r.reasoningChars,
      finishReason: r.finishReason,
      tools: r.toolCalls.map((t) => t.name),
      error: r.error,
    });
    if (r.error) { terminatedBy = `请求错误：${r.error}`; break; }
    if (r.text) finalText += r.text;

    if (r.toolCalls.length === 0) { terminatedBy = '模型停止调用工具（自然结束）'; break; }

    messages.push({
      role: 'assistant',
      content: r.text,
      tool_calls: r.toolCalls.map((t) => ({
        id: t.id || `call_${turn}_${t.name}`,
        type: 'function',
        function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) },
      })),
    });

    let stopped = false;
    for (const call of r.toolCalls) {
      const result = await stub.exec(call);
      messages.push({
        role: 'tool',
        tool_call_id: call.id || `call_${turn}_${call.name}`,
        content: result.success ? result.output : `Error: ${result.error}`,
      });
      if (result.terminal) { terminatedBy = result.error; stopped = true; }
    }
    if (stopped) break;
  }

  // 跑满轮次预算仍未收敛，本身就是结论：任务太长，8 轮不够。
  if (!terminatedBy) terminatedBy = `达到轮次上限（${turnBudget} 轮，未收敛）`;

  return {
    turns,
    finalText,
    stubState: {
      breakdownAttempts: stub.state.breakdownAttempts.map((a) => ({
        present: {
          synopsis: Boolean(a.args?.synopsis),
          episodes: Array.isArray(a.args?.episodes) ? a.args.episodes.length : 0,
          narrativeBeats: Array.isArray(a.args?.narrativeBeats) ? a.args.narrativeBeats.length : 0,
          characters: Array.isArray(a.args?.characters) ? a.args.characters.length : 0,
          scenes: Array.isArray(a.args?.scenes) ? a.args.scenes.length : 0,
          sourceEvidence: a.evidence,
        },
        errors: a.errors,
      })),
      duplicateTerminated: stub.state.duplicateTerminated,
      scriptCommitted: stub.state.scriptCommitted,
      shotsCommitted: stub.state.shotsCommitted,
      reviewSaved: stub.state.reviewSaved,
      gateBlocked: stub.state.gateBlocked,
      episodeScriptAttempts: stub.state.episodeScriptAttempts,
      shortCircuitLog: stub.state.shortCircuitLog,
      assetPromptAttempts: stub.state.assetPromptAttempts,
      promptBatches: stub.state.promptBatches,
    },
    terminatedBy,
    messages,
  };
}

/**
 * 判定「这次失败是基础设施问题」而不是产品行为。
 *
 * 依据本轮定位的根因：网关会把请求随机派给一个**恒返回 HTTP 200 + `content: null`** 的上游
 * （回显 `deepseek-v4.1`，实测约占 47% 流量）。这类响应在流式下表现为「整轮什么都没吐」。
 *
 * 注意：这里只在**探针**里重试。真实应用里重放付费步骤会重复扣费，
 * 所以应用侧的对应做法是「只重放未落库的步骤」，不是简单重试。
 */
function isInfrastructureFailure(r) {
  const t = String(r.terminatedBy || '');
  if (/HTTP 5\d\d/.test(t)) return true;
  if (/upstream error|do request failed/i.test(t)) return true;
  if (/首包超时|空闲超时|fetch failed|超时中断/.test(t)) return true;
  // 空响应特征：整轮既没有工具调用也没有任何文本 —— 这正是「坏上游返回空」的样子。
  const anyTool = r.turns.some((x) => x.tools.length > 0);
  const anyText = r.turns.some((x) => (x.textChars ?? 0) > 0);
  if (!anyTool && !anyText) return true;
  return false;
}

/**
 * 带基础设施重试的 Agent 循环。
 *
 * 网关可用率只有 37%–57%，不重试的话每个模块都要靠运气才能跑完，
 * 模块级通过率完全不可比。这里对**基础设施失败**自动重试，对**产品行为**（模型真的跑偏）不重试。
 *
 * 安全性：探针的工具全部是内存桩，重试没有副作用。**真实应用不可照抄**——见 isInfrastructureFailure 注释。
 */
async function runAgentLoop(args) {
  const retries = Math.max(1, Number(process.env.PROBE_RETRIES || 3));
  const attempts = [];
  let last = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    last = await runAgentLoopOnce(args);
    const infra = isInfrastructureFailure(last);
    const toolCalls = last.turns.reduce((n, t) => n + t.tools.length, 0);
    attempts.push({
      attempt,
      terminatedBy: last.terminatedBy,
      toolCalls,
      infra,
    });
    if (!infra) break;
    if (attempt < retries) {
      console.log(`      ⟳ 基础设施失败，重试 ${attempt + 1}/${retries}（${String(last.terminatedBy).slice(0, 70)}）`);
    }
  }
  const exhausted = attempts.length > 0 && attempts[attempts.length - 1].infra === true;
  return { ...last, infraAttempts: attempts, infraExhausted: exhausted };
}

// ── 模块 ─────────────────────────────────────────────────────────────
const MODULES = {};

MODULES.probe = async () => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  let status = 0;
  let ids = [];
  try {
    const res = await fetch(`${BASE}/v1/models`, { headers: { Authorization: `Bearer ${KEY}` }, signal: ac.signal });
    status = res.status;
    ids = ((await res.json()).data || []).map((m) => m.id);
  } catch { /* 网络不可达 */ } finally { clearTimeout(timer); }
  return {
    detail: {
      服务可达: status === 200,
      声明模型数: ids.length,
      目标模型存在: ids.includes(MODEL),
      系统提示词字符数: SYSTEM_PROMPT.length,
      可见工具数: defs.length,
      工具定义字符数: defs.reduce((n, d) => n + JSON.stringify(d).length, 0),
      工坊工具数: defs.filter((d) => d.name.startsWith('workshop_')).length,
    },
  };
};

/** 第①步「用 Idea 生成故事规划」：与 StepScript.generateFromIdea 完全同源的组合。 */
const IDEA_EXECUTION_REQUIREMENT = '执行要求：这是工坊第一阶段的直接生成操作。请读取当前工坊状态后，直接调用 workshop_set_breakdown 一次性写入 synopsis、episodes、narrativeBeats、characters、scenes（如项目挂了剧本源文件，还必须附上 3-12 条逐字 sourceEvidence）；不要跳转文案工作室，不要创建文案文档，不要要求用户手动导入。写入完成后刷新工坊界面并汇报生成结果。';

function breakdownTools({ hasSourceMaterial = false } = {}) {
  const required = h.breakdownSchema.workshopBreakdownRequiredFields({
    hasExistingBreakdown: false,
    hasSourceMaterial,
  });
  return { required, tools: withResolvedRequired(defs, 'workshop_set_breakdown', required) };
}

/**
 * 注入用的剧本源文件。有源文件的项目在应用里会冻结剧本 revision 并强制 Draft Review，
 * 因此这份文本必须包含可逐字摘录的人物、关系与事件短句，否则 sourceEvidence 无从产生。
 */
const SOURCE_SCRIPT = {
  name: '孤岛剧本_v1.txt',
  path: '/probe/孤岛剧本_v1.txt',
  content: [
    '第一场 沙滩 日',
    '林越从湿沙里撑起身，手里攥着一把折叠刀。',
    '苏晚站在他三步之外，怀里抱着一个密封塑料桶。',
    '“桶里是水吗？”林越问。',
    '“不告诉你。”苏晚把桶抱得更紧。',
    '第二场 崖边 昏',
    '陈默把收音机举过头顶，试着搜寻信号。',
    '赵一舟蹲在礁石后面，把一根铁钉塞进口袋。',
    '“三天。最多三天。”陈默说，“水不够，我们就得抢。”',
    '第三场 营地 夜',
    '苏晚拧开塑料桶，清水从桶底滤出，滴进林越的折叠刀刀面。',
    '原来那是一只净水器。',
    '赵一舟慢慢把铁钉放回礁石缝里。',
    '远处的海面上，一艘没有灯光的船正缓缓靠近。',
  ].join('\n'),
};

const PROBE_REVISION_ID = 'rev-probe-0001';

/**
 * ③④步的种子素材。
 *
 * 这两步是「为已有角色/场景/分镜写提示词」，不给素材模型无事可做，
 * 测出来的只会是「探针没素材」。id 必须与 workshop_get_state 返回的一致，
 * 否则模型是在**幻觉 id**——真实工具对未知 id 会静默返回成功（见 F12），
 * 所以这种幻觉只能靠探针自己统计（`assetPromptUnknownId`），不能指望工具报错。
 */
const PROBE_CHARACTERS = [
  { id: 'char-linyue', name: '林越', kind: 'character', role: 'protagonist', appearance: '三十岁男骑手，短寸头，左眉一道旧疤，黄色反光雨衣' },
  { id: 'char-suwan', name: '苏晚', kind: 'character', role: 'supporting', appearance: '二十七岁女记者，齐肩黑发，深灰风衣，右手戴薄手套' },
];
const PROBE_SCENES = [
  { id: 'scene-s1', name: '雨夜便利店门口', kind: 'scene', timeOfDay: '夜', description: '便利店门口雨棚下，地面积水反光，货架冷白光溢出玻璃门，街道深处一片昏黄' },
];
const PROBE_SHOTS = [
  { shotNo: 'S1-01', sceneId: 'scene-s1', description: '林越站在雨棚下，右手举着手机，正对便利店玻璃门', duration: 5, shotPlanningMode: 'single-timeline' },
  { shotNo: 'S1-02', sceneId: 'scene-s1', description: '林越跨上电动车，背对镜头，车头朝向街道深处', duration: 4, shotPlanningMode: 'single-timeline' },
];

/**
 * ④步真实依赖的状态字段。
 *
 * 实测教训：只给 shots 的基础字段时，模型会**正确地拒绝写入**——它明确报告
 * 「h3Task / videoModel / imageReferenceOrder / bibles 缺失，不能在参考编号靠猜的
 * 情况下写提示词」。这不是产品缺陷，是桩保真度不够，所以必须补齐这些字段。
 */
const PROBE_VIDEO_MODEL = 'doubao-seedance-2-0-pro';
const PROBE_BIBLES = {
  director: '统一冷色调夜景，低饱和；镜头语言以手持跟拍为主，不做无动机快切',
  character: '林越的黄色反光雨衣是画面唯一高饱和色，其余色相压低',
  scene: '便利店冷白光源与街道昏黄路灯构成双光源，雨棚下为暗部',
  continuity: '雨持续不停，地面积水反射保持一致，湿衣状态不反转',
};
const PROBE_QUALITY_LEARNING = { avoidanceRules: [], highScorePromptExamples: [] };

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/**
 * ④的两种模板结构特征。
 *
 * F7a 此前只用单测锁定了「模板规则会随提示词下发」，但**没验证模型是否照做**。
 * 这里把结构判定做成探针的一等输出：只看提示词带了规则不算数，
 * 要看模型真正写出来的 videoPrompt 是六段式还是经典标题。
 */
const UNIVERSAL_SECTION_HEADERS = ['【素材身份】', '【空间与初始站位】', '【一句话概述】', '【时间戳动作与机位】', '【物理与一致性】', '【视觉与声音】'];
const LEGACY_HEADER_RE = /分镜场景设定在|分镜具体动作描述|镜头\d+-1/;

/**
 * ③的资产提示词格式契约（来自 `buildAssetPromptsPrompt` 正文与
 * `WORKSHOP_CHARACTER_TEMPLATE_ZH`）。
 *
 * 判定「写没写」不够——③ 的价值全在格式：角色必须是**设定板多格母版**，
 * 场景必须是**无人物 + 45° 斜俯视/高位广角**的空景母版，MJ 版必须是英文逗号短语式。
 */
const CHARACTER_ZH_MARKERS = ['设定板', '主立绘', '正脸', '正面', '侧面', '背面', '浅灰', '细节'];
const CHARACTER_MJ_MARKERS = ['character bible sheet', 'turnaround'];
const SCENE_MJ_MARKERS = ['empty environment overview', 'oblique', 'no people'];
const SCENE_ZH_ANGLE_RE = /45\s*[°度]|斜俯视|高位广角|俯视/;
const SCENE_ZH_EMPTY_RE = /无(?:任何)?人物|空景|无人/;

/** 按资产类型核对 GPT / MJ 两版提示词是否命中必需要素。 */
function checkAssetContent(kind, prompt, mjPrompt) {
  const zh = String(prompt ?? '');
  const mj = String(mjPrompt ?? '');
  // MJ 版必须是英文：非 ASCII 字符占比过高说明模型把中文写进了 MJ 槽位。
  const asciiRatio = mj ? mj.replace(/[^\x00-\x7F]/g, '').length / mj.length : 0;
  const mjLower = mj.toLowerCase();
  if (kind === 'character') {
    return {
      zhHits: CHARACTER_ZH_MARKERS.filter((m) => zh.includes(m)),
      zhTotal: CHARACTER_ZH_MARKERS.length,
      mjHits: CHARACTER_MJ_MARKERS.filter((m) => mjLower.includes(m)),
      mjTotal: CHARACTER_MJ_MARKERS.length,
      asciiRatio,
    };
  }
  if (kind === 'scene') {
    const zhHits = [
      ...(SCENE_ZH_ANGLE_RE.test(zh) ? ['俯视/45°视角'] : []),
      ...(SCENE_ZH_EMPTY_RE.test(zh) ? ['无人物'] : []),
      ...(/水印|文字/.test(zh) ? ['无文字/水印约束'] : []),
    ];
    return {
      zhHits,
      zhTotal: 3,
      mjHits: SCENE_MJ_MARKERS.filter((m) => mjLower.includes(m)),
      mjTotal: SCENE_MJ_MARKERS.length,
      asciiRatio,
    };
  }
  return { zhHits: [], zhTotal: 0, mjHits: [], mjTotal: 0, asciiRatio };
}

/** 与真实工具同语义的参考编号：场景占 @图片一，角色依次排开。 */
function probeRefBindings() {
  const list = [
    ...PROBE_SCENES.map((s) => ({ kind: 'scene', label: `场景 ${s.name}`, id: s.id })),
    ...PROBE_CHARACTERS.map((c) => ({ kind: 'character', label: `角色 ${c.name}`, id: c.id })),
  ];
  return list.map((it, i) => ({ ref: `@图片${CN_NUM[i + 1]}`, ...it, path: `/probe/${it.id}.png` }));
}

/** 逐轮工具调用串，各模块详情共用。 */
function turnTrace(r) {
  return r.turns.map((t) => `T${t.turn}:[${t.tools.join(',') || '无'}]`).join(' ');
}

/**
 * 服务端健康采样。
 *
 * 起因：本轮反复出现「同一模块有时过、有时 500、有时空闲超时」，但 `/v1/models` 一直 200。
 * 用**最小请求**（无工具、max_tokens 16）采样，把 prefill 体积这个变量排除掉，
 * 只看网关把请求派给了谁、回来的是什么。
 *
 * 关键观测：响应体的 `model` 回显。若网关背后有多个上游，
 * 回显会暴露它们的真实身份，也就能解释「同一请求时好时坏」。
 */
MODULES.health = async () => {
  const N = Number(process.env.PROBE_HEALTH_N || 12);
  const httpDist = {};
  const modelDist = {};
  let nullContent = 0;
  let usable = 0;
  const brokenEchoes = new Set();
  const t0 = Date.now();

  for (let i = 0; i < N; i++) {
    try {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: '只回复两个字：可用' }],
          max_tokens: 16,
          stream: false,
        }),
        signal: AbortSignal.timeout(45_000),
      });
      httpDist[res.status] = (httpDist[res.status] || 0) + 1;
      if (!res.ok) continue;
      const j = await res.json();
      const echoed = j.model ?? '(none)';
      modelDist[echoed] = (modelDist[echoed] || 0) + 1;
      const content = j.choices?.[0]?.message?.content ?? null;
      if (content === null) {
        nullContent += 1;
        brokenEchoes.add(echoed);
      } else {
        usable += 1;
      }
    } catch (e) {
      const key = `ERR:${e.name}`;
      httpDist[key] = (httpDist[key] || 0) + 1;
    }
  }

  const pct = (n) => `${Math.round((n / N) * 100)}%`;
  return {
    pass: usable === N,
    detail: {
      '采样次数': N,
      'HTTP 分布': JSON.stringify(httpDist),
      'model 回显分布': JSON.stringify(modelDist),
      '回显与请求模型一致': modelDist[MODEL] ? `${modelDist[MODEL]}/${N}` : `0/${N}`,
      'content 为 null': `${nullContent}/${N}（${pct(nullContent)}）`,
      '空内容的回显模型': brokenEchoes.size ? [...brokenEchoes].join('、') : '无',
      '可用响应': `${usable}/${N}（${pct(usable)}）`,
      '总耗时(ms)': Date.now() - t0,
      '说明': 'HTTP 200 但 content=null 表示网关把一个正常请求派给了不健康的上游；'
        + '这类响应在上层表现为「模型没吐字」，会被应用的流式看门狗报成空闲超时。',
    },
  };
};

function totalMs(r) {
  return r.turns.reduce((n, t) => n + t.totalMs, 0);
}


function breakdownDetail(r) {
  const attempts = r.stubState.breakdownAttempts;
  const last = attempts[attempts.length - 1];
  return {
    attempts,
    last,
    detail: {
      '拆解工具被调用次数': attempts.length,
      '最后一次提交字段': last ? JSON.stringify(last.present) : '（未调用）',
      '应用校验结果': !last ? '未触达拆解' : last.errors.length === 0 ? '通过' : `不通过（${last.errors.length} 项）`,
      '校验错误': last ? last.errors.slice(0, 4).join(' / ') : '—',
      'Draft Review 凭据': r.stubState.reviewSaved
        ? `${r.stubState.reviewSaved.revisionId} / ${r.stubState.reviewSaved.status}`
        : '（未提交）',
      '被门禁拦下': r.stubState.gateBlocked ?? '无',
      '分镜表是否写入': r.stubState.shotsCommitted ? '是' : '否',
      '重复读取被短路': r.stubState.shortCircuitLog.length > 0
        ? `${r.stubState.shortCircuitLog.length} 次（${r.stubState.shortCircuitLog.join('、')}）`
        : '0 次',
      '各轮工具调用': r.turns.map((t) => `T${t.turn}:[${t.tools.join(',') || '无'}]`).join(' '),
      '结束原因': r.terminatedBy,
      '总耗时(ms)': r.turns.reduce((n, t) => n + t.totalMs, 0),
      '单轮最长(ms)': Math.max(0, ...r.turns.map((t) => t.totalMs)),
      '单轮最晚首字节(ms)': Math.max(0, ...r.turns.map((t) => t.firstByteMs ?? 0)),
    },
  };
}

MODULES.script = async () => {
  const { required, tools } = breakdownTools();
  const prompt = `${h.buildStoryDirectorPrompt(IDEA, SPEC)}\n\n${IDEA_EXECUTION_REQUIREMENT}`;
  const r = await runAgentLoop({ prompt, tools });
  const hasScene = /Scene\s*\d|场景\s*\d|第[一二三四五六七八九十\d]+场/.test(r.finalText);
  const { detail, last } = breakdownDetail(r);
  return {
    pass: Boolean(last) && last.errors.length === 0,
    detail: {
      '提示词字符数': prompt.length,
      '对外声明 required': JSON.stringify(required),
      '模型产出的剧本文本': `${r.finalText.length} 字符`,
      '含 Scene/场次结构': hasScene,
      ...detail,
    },
    artifact: { prompt, loop: r },
  };
};

/** 第②步逐集剧本：buildEpisodeScreenplayPrompt + StepBreakdown 追加的执行要求。 */
MODULES.episode = async () => {
  const prompt = `${h.buildEpisodeScreenplayPrompt({
    idea: IDEA,
    episodeNo: '1',
    title: '孤岛第一夜',
    synopsis: '全班被投放到孤岛，每人随机获得一件道具。',
    openingState: '众人在沙滩上醒来，手里各握一件随机道具。',
    centralConflict: '水源只够撑三天，道具强弱悬殊引发抢夺。',
    climax: '最弱的道具被证明是净水器，权力关系瞬间反转。',
    cliffhanger: '远处海面出现一艘没有灯光的船。',
    endingState: '众人围着净水器达成临时同盟。',
    episodeDurationSec: 90,
    detailLevel: 'detailed',
    expansionPolicy: 'balanced',
    genre: '生存悬疑',
    audience: '全年龄',
    tone: '紧张',
    endingType: '反转式',
    outputLanguage: 'zh-CN',
  })}\n\n执行要求：这是第二阶段第 1 集的直接生成操作。请读取当前工坊状态，生成完整详细剧本以及角色、场景、道具资产档案，然后必须调用 workshop_set_episode_script 保存到 episode_no="1"。不要跳转文案工作室，不要创建文案文档，不要要求手动导入。保存成功后刷新工坊并汇报。`;
  // 逐集剧本是长输出任务：单轮耗时天然高于普通对话轮，
  // 用更宽的预算，避免把「模型仍在写作」误判成服务超时。
  const r = await runAgentLoop({
    prompt,
    tools: defs,
    options: { episodes: [{ no: '1', title: '孤岛第一夜' }], hasExistingBreakdown: true },
    timeoutMs: Number(process.env.PROBE_EPISODE_TIMEOUT_MS || 600_000),
    maxTurns: Number(process.env.PROBE_EPISODE_TURNS || 6),
  });
  const attempts = r.stubState.episodeScriptAttempts;
  const committed = attempts.find((a) => a.scriptChars > 0);
  return {
    pass: r.stubState.scriptCommitted,
    detail: {
      '提示词字符数': prompt.length,
      '对话正文字符数': r.finalText.length,
      '单轮超时预算(ms)': Number(process.env.PROBE_EPISODE_TIMEOUT_MS || 600_000),
      '是否调用 workshop_set_episode_script': r.stubState.scriptCommitted ? '是（已落库）' : '否（只停留在对话文本）',
      '写入集号': committed?.episodeNo ?? '—',
      '落库剧本文本': committed ? `${committed.scriptChars} 字符` : '—',
      '各轮工具调用': r.turns.map((t) => `T${t.turn}:[${t.tools.join(',') || '无'}]`).join(' '),
      '结束原因': r.terminatedBy,
      '总耗时(ms)': r.turns.reduce((n, t) => n + t.totalMs, 0),
      '单轮最长(ms)': Math.max(0, ...r.turns.map((t) => t.totalMs)),
    },
    artifact: { prompt, loop: r },
  };
};

/** 新版一键全流程：buildAutoRunSteps 的第 1 步（拆解），即应用现在实际下发的形态。 */
MODULES.autosteps = async () => {
  const steps = h.prompts.buildAutoRunSteps();
  const first = steps[0];
  // 真实场景：项目已上传剧本源文件并冻结 revision，第 1 步必须先过 Draft Review 才能拆解。
  const { required, tools } = breakdownTools({ hasSourceMaterial: true });
  const r = await runAgentLoop({
    prompt: first.prompt,
    tools,
    options: { sourceFiles: [SOURCE_SCRIPT], scriptRevisionId: PROBE_REVISION_ID },
    timeoutMs: Number(process.env.PROBE_AUTOSTEPS_TIMEOUT_MS || 420_000),
    // 第 1 步要跑完 get_state → read_source → read_file → set_script_review
    // → set_breakdown → set_bibles → set_shots → set_step_status，8 轮不够。
    maxTurns: Number(process.env.PROBE_AUTOSTEPS_TURNS || 16),
  });
  const { detail, last } = breakdownDetail(r);
  return {
    pass: Boolean(last) && last.errors.length === 0 && r.stubState.reviewSaved?.status === 'passed',
    detail: {
      '步骤数': steps.length,
      '步骤与提示词字符数': steps.map((s) => `${s.label}=${s.prompt.length}`).join(' | '),
      '第 1 步提示词字符数': first.prompt.length,
      '含工具纪律段': first.prompt.includes(h.prompts.WORKSHOP_TOOL_DISCIPLINE) ? '是' : '否',
      '对外声明 required': JSON.stringify(required),
      '注入源文件': SOURCE_SCRIPT.name,
      '注入剧本版本': PROBE_REVISION_ID,
      ...detail,
    },
    artifact: { steps: steps.map((s) => ({ id: s.id, label: s.label, prompt: s.prompt })), loop: r },
  };
};

MODULES.breakdown = async () => {
  const required = h.breakdownSchema.workshopBreakdownRequiredFields({
    hasExistingBreakdown: false,
    hasSourceMaterial: false,
  });
  const tools = withResolvedRequired(defs, 'workshop_set_breakdown', required);
  const prompt = h.prompts.buildBreakdownPrompt();
  const r = await runAgentLoop({
    prompt: `${prompt}\n\n【本项目无剧本源文件（sources 为空），请直接依据 Idea「${IDEA}」创作并完成首次拆解】`,
    tools,
  });
  const attempts = r.stubState.breakdownAttempts;
  const last = attempts[attempts.length - 1];
  return {
    pass: Boolean(last) && last.errors.length === 0,
    detail: {
      '对外声明 required': JSON.stringify(required),
      '拆解工具被调用次数': attempts.length,
      '最后一次提交字段': last ? JSON.stringify(last.present) : '（未调用）',
      '应用校验结果': !last ? '未触达' : last.errors.length === 0 ? '通过' : `不通过（${last.errors.length} 项）`,
      '校验错误': last ? last.errors.slice(0, 4).join(' / ') : '—',
      '各轮工具调用': r.turns.map((t) => `T${t.turn}:[${t.tools.join(',') || '无'}]`).join(' '),
      '结束原因': r.terminatedBy,
      '总耗时(ms)': r.turns.reduce((n, t) => n + t.totalMs, 0),
    },
    artifact: { required, loop: r },
  };
};

/** 用户实际失败的那条路径：一键全流程（buildAutoRunPrompt，一次要求 6 步） */
MODULES.autorun = async () => {
  const required = h.breakdownSchema.workshopBreakdownRequiredFields({
    hasExistingBreakdown: false,
    hasSourceMaterial: false,
  });
  let tools = withResolvedRequired(defs, 'workshop_set_breakdown', required);
  tools = withResolvedRequired(tools, 'workshop_set_shots', ['shots']);
  const prompt = h.prompts.buildAutoRunPrompt();
  const r = await runAgentLoop({ prompt, tools });
  const attempts = r.stubState.breakdownAttempts;
  const last = attempts[attempts.length - 1];
  return {
    pass: Boolean(last) && last.errors.length === 0,
    detail: {
      '提示词字符数': prompt.length,
      '拆解工具被调用次数': attempts.length,
      '最后一次提交字段': last ? JSON.stringify(last.present) : '（未调用）',
      '应用校验结果': !last ? '未触达拆解' : last.errors.length === 0 ? '通过' : `不通过（${last.errors.length} 项）`,
      '校验错误': last ? last.errors.slice(0, 4).join(' / ') : '—',
      '是否触发重复调用刹车': r.stubState.duplicateTerminated ? '是' : '否',
      '各轮工具调用': r.turns.map((t) => `T${t.turn}:[${t.tools.join(',') || '无'}]`).join(' '),
      '结束原因': r.terminatedBy,
      '总耗时(ms)': r.turns.reduce((n, t) => n + t.totalMs, 0),
      '单轮最长(ms)': Math.max(0, ...r.turns.map((t) => t.totalMs)),
      '单轮最晚首字节(ms)': Math.max(0, ...r.turns.map((t) => t.firstByteMs ?? 0)),
    },
    artifact: { prompt, loop: r },
  };
};

MODULES.shots = async () => {
  const tools = withResolvedRequired(defs, 'workshop_set_shots', ['shots']);
  const prompt = `请依据以下已确认的拆解，直接调用 workshop_set_shots 写入分镜表（本集 6 镜，mode 用 replace）。

梗概：一个外卖骑手在暴雨的深夜接下超时风险极高的最后一单，在积水、摔倒与赔偿的两难中，终于抵达那扇亮着灯的门。
Scene S1《雨夜接单》— 骑手林越在便利店门口抢下最后一单。
角色：林越（三十岁男骑手，黄色雨衣）。
要求：每镜写清 shotNo、sceneId、description（含人物相对场景锚点的位置与朝向）、duration、shotPlanningMode。`;
  const r = await runAgentLoop({ prompt, tools });
  return {
    pass: r.turns.some((t) => t.tools.includes('workshop_set_shots')),
    detail: {
      '各轮工具调用': r.turns.map((t) => `T${t.turn}:[${t.tools.join(',') || '无'}]`).join(' '),
      '结束原因': r.terminatedBy,
      '总耗时(ms)': r.turns.reduce((n, t) => n + t.totalMs, 0),
    },
    artifact: { loop: r },
  };
};

/**
 * 重复读取短路验证。
 *
 * 刻意只挂 2 个工具：全量 118 工具（83KB 定义）会让这个服务在 prefill 上长时间不吐字节，
 * 测不出短路行为；最小工具集能把「模型被明确告知没有变化之后会不会继续复读」这件事单独拎出来。
 */
MODULES.repeatread = async () => {
  const pick = (name) => defs.filter((d) => d.name === name);
  const tools = pick('workshop_get_state').concat(pick('workshop_set_step_status'));
  const prompt = `请依次执行以下四步，每一步都要真的调用工具，不要合并：
1) 调用 workshop_get_state 读取当前工坊状态；
2) 调用 workshop_set_step_status 把 breakdown 标记为 in-progress；
3) 再次调用 workshop_get_state 确认写入结果；
4) 再调用一次 workshop_get_state 复核。
最后汇报每一步的结果。`;
  const r = await runAgentLoop({
    prompt,
    tools,
    options: {},
    timeoutMs: Number(process.env.PROBE_REPEATREAD_TIMEOUT_MS || 180_000),
    maxTurns: 8,
  });
  const log = r.stubState.shortCircuitLog;
  return {
    pass: log.length >= 1 && r.turns.some((t) => t.tools.includes('workshop_get_state')),
    detail: {
      '可见工具数': tools.length,
      '工具定义字符数': tools.reduce((n, d) => n + JSON.stringify(d).length, 0),
      '各轮工具调用': r.turns.map((t) => `T${t.turn}:[${t.tools.join(',') || '无'}]`).join(' '),
      '重复读取被短路': log.length > 0 ? `${log.length} 次（${log.join('、')}）` : '0 次',
      '短路后模型是否收尾': r.terminatedBy,
      '总耗时(ms)': r.turns.reduce((n, t) => n + t.totalMs, 0),
    },
    artifact: { prompt, loop: r },
  };
};

/**
 * ③资产提示词：buildAssetPromptsPrompt 的真实提示词 + 种子角色/场景，
 * 看模型会不会真的把两个版本（GPT 中文 / MJ 英文）都写进 workshop_set_asset_prompt。
 *
 * 用全量 defs（与应用一致）。桩执行器**不实现** workshop_generate，
 * 所以即使模型越权去调生成，也只会拿到「未实现」，不会真实扣费。
 */
MODULES.assets = async () => {
  const prompt = h.prompts.buildAssetPromptsPrompt();
  const r = await runAgentLoop({
    prompt,
    tools: defs,
    options: { characters: PROBE_CHARACTERS, scenes: PROBE_SCENES, hasExistingBreakdown: true },
    timeoutMs: Number(process.env.PROBE_ASSETS_TIMEOUT_MS || 420_000),
    maxTurns: Number(process.env.PROBE_ASSETS_TURNS || 12),
  });
  const attempts = r.stubState.assetPromptAttempts;
  const expected = [...PROBE_CHARACTERS, ...PROBE_SCENES].map((a) => a.id);
  // 「两个版本都写全」才是通过：第③步提示词明确要求 prompt 与 mjPrompt 同时写入。
  const complete = attempts.filter((a) => a.known && a.promptChars > 0 && a.mjPromptChars > 0);
  const covered = new Set(complete.map((a) => a.id));
  const missing = expected.filter((id) => !covered.has(id));
  const avg = (key) => (complete.length ? Math.round(complete.reduce((n, a) => n + a[key], 0) / complete.length) : 0);
  // 内容合规：GPT 与 MJ 两版都要命中该资产类型的必需要素，且 MJ 版必须是英文。
  const conforming = complete.filter(
    (a) => a.zhHits.length === a.zhTotal && a.mjHits.length === a.mjTotal && a.asciiRatio >= 0.9,
  );
  const nonConforming = complete.filter((a) => !conforming.includes(a));
  return {
    pass: missing.length === 0 && nonConforming.length === 0,
    detail: {
      '提示词字符数': prompt.length,
      '种子资产数': expected.length,
      'workshop_set_asset_prompt 调用次数': attempts.length,
      '两版写全的资产': [...covered].join('、') || '—',
      '未覆盖的资产': missing.join('、') || '无',
      'GPT 版平均字符数': avg('promptChars'),
      'MJ 版平均字符数': avg('mjPromptChars'),
      '内容合规（格式契约）': complete.length === 0
        ? '未写入，无法判定'
        : `${conforming.length}/${complete.length} 资产命中全部必需要素`,
      '不合规明细': nonConforming.length === 0
        ? '无'
        : nonConforming.map((a) => `${a.id}：GPT ${a.zhHits.length}/${a.zhTotal}、MJ ${a.mjHits.length}/${a.mjTotal}、英文占比 ${Math.round(a.asciiRatio * 100)}%`).join('；'),
      'MJ 版平均英文占比': complete.length ? `${Math.round(avg('asciiRatio') * 100)}%` : '—',
      '各资产命中情况': complete.map((a) => `${a.id}[GPT ${a.zhHits.join('/') || '无'}｜MJ ${a.mjHits.join('/') || '无'}]`).join(' '),
      // F12 修复后：未知 id 会被工具层明确拒绝（不再是静默假成功），这两项是可归因的失败信号。
      '幻觉 id 的调用次数': r.stubState.assetPromptUnknownId || 0,
      '未写 MJ 版的调用次数': r.stubState.assetPromptMissingMj || 0,
      '是否越权调用 workshop_generate': r.turns.some((t) => t.tools.includes('workshop_generate'))
        ? '是（桩已拦截，未真实扣费）' : '否',
      '各轮工具调用': turnTrace(r),
      '结束原因': r.terminatedBy,
      '总耗时(ms)': totalMs(r),
    },
    artifact: { prompt, loop: r },
  };
};

/**
 * ④分镜提示词：buildShotPromptsPrompt 的真实提示词 + 种子分镜，
 * 看模型会不会真的把 imagePrompt / videoPrompt 写进 workshop_set_prompts。
 *
 * 模板规则是否随提示词下发，也在详情里显式断言一次。
 */
MODULES.shotprompts = async () => {
  const template = String(process.env.PROBE_TEMPLATE || 'legacy') === 'universal' ? 'universal' : 'legacy';
  const prompt = h.prompts.buildShotPromptsPrompt('', template);
  const r = await runAgentLoop({
    prompt,
    tools: defs,
    options: {
      characters: PROBE_CHARACTERS,
      scenes: PROBE_SCENES,
      shots: PROBE_SHOTS,
      hasExistingBreakdown: true,
    },
    timeoutMs: Number(process.env.PROBE_SHOTPROMPTS_TIMEOUT_MS || 420_000),
    maxTurns: Number(process.env.PROBE_SHOTPROMPTS_TURNS || 12),
  });
  const batches = r.stubState.promptBatches.filter((b) => !b.error);
  const expected = PROBE_SHOTS.map((s) => s.shotNo);
  const covered = new Set(batches.flatMap((b) => b.shotNos || []));
  const missing = expected.filter((n) => !covered.has(n));
  const withVideo = batches.reduce((n, b) => n + (b.withVideo || 0), 0);
  const withImage = batches.reduce((n, b) => n + (b.withImage || 0), 0);
  // 逐条长度（去空白，与产品 textLen 同口径）。旧版只留了批次平均值，
  // 无法看出「哪一条偏短」，F10 的分布特征因此被抹平。
  const chars = batches.flatMap((b) => b.videoChars ?? (b.withVideo ? [b.avgVideoChars] : []));
  // 导演级内容检查（F18 起桩会真的返回）：这是探针**第一次**能自己报出内容质量问题，
  // 此前 F10 只能靠人工分析留档参数才能发现。
  const directorWarnings = batches.flatMap((b) => b.directorWarnings || []);
  // F7a 的真正验收点：模型写出来的结构必须与所选模板一致。
  const sectionHits = new Set(batches.flatMap((b) => b.universalSectionHits || []));
  const legacyHeaderCount = batches.reduce((n, b) => n + (b.legacyHeaderCount || 0), 0);
  const structure = withVideo === 0
    ? '未写入，无法判定'
    : sectionHits.size > 0
      ? `新版六段式（命中 ${sectionHits.size}/${UNIVERSAL_SECTION_HEADERS.length} 个段落标题）`
      : legacyHeaderCount > 0
        ? `经典版标题（${legacyHeaderCount} 条命中「分镜场景设定在/分镜具体动作描述/镜头N-1」）`
        : '两种特征都没命中（需人工看原文）';
  return {
    pass: missing.length === 0 && withVideo >= expected.length,
    detail: {
      '模板': template,
      '实际写出的结构': structure,
      '结构是否符合所选模板': withVideo === 0
        ? '—'
        : (template === 'universal') === (sectionHits.size > 0) ? '是' : '否',
      '提示词字符数': prompt.length,
      '模板规则是否在提示词里': prompt.includes(h.prompts.shotPromptTemplateRule(template)) ? '是' : '否',
      '种子分镜数': expected.length,
      'workshop_set_prompts 调用次数': r.stubState.promptBatches.length,
      '被致命门禁挡下的批次': r.stubState.promptBatches.filter((b) => b.error).length
        ? r.stubState.promptBatches.filter((b) => b.error).map((b) => b.error).join('、')
        : '无',
      '覆盖分镜': [...covered].join('、') || '—',
      '未覆盖分镜': missing.join('、') || '无',
      '含 videoPrompt 条数': withVideo,
      '含 imagePrompt 条数': withImage,
      'videoPrompt 平均字符数': chars.length ? Math.round(chars.reduce((a, b) => a + b, 0) / chars.length) : 0,
      'videoPrompt 长度分布（去空白）': chars.length ? chars.join('/') : '—',
      '内容检查警告条数': directorWarnings.length,
      '内容检查警告': directorWarnings.length ? directorWarnings.slice(0, 8).join(' ｜ ') : '无',
      '是否越权调用 workshop_generate': r.turns.some((t) => t.tools.includes('workshop_generate'))
        ? '是（桩已拦截，未真实扣费）' : '否',
      '各轮工具调用': turnTrace(r),
      '结束原因': r.terminatedBy,
      '总耗时(ms)': totalMs(r),
    },
    artifact: { prompt, loop: r },
  };
};

/**
 * 一键全流程的第 2/3 步（资产提示词 / 分镜提示词）—— 提示词形态与独立版**不同**。
 *
 * - 第 2 步 = 前置校验 + `buildAssetPromptsPrompt()` + 纪律段（独立版的**超集**）。
 * - 第 3 步 = 前置校验 + `AUTO_RUN_PROMPTS_STEP_BODY`（**手写正文**）+ 模板规则 + 纪律段。
 *   它刻意不复用 `buildShotPromptsPrompt()`（后者带完整 h3 技能正文，体积太大）。
 *
 * 也就是说第 3 步是**唯一从未实跑过的提示词形态**，而 F7a 的缺陷正好出在这一步。
 * 这里把两步一起跑，并报出第 3 步实际写出的结构，验证 F7a 在**一键全流程形态**下同样成立。
 */
MODULES.autosteps34 = async () => {
  const template = String(process.env.PROBE_TEMPLATE || 'legacy') === 'universal' ? 'universal' : 'legacy';
  const steps = h.prompts.buildAutoRunSteps('', { videoPromptTemplate: template });
  const assetsStep = steps[1];
  const promptsStep = steps[2];

  const r2 = await runAgentLoop({
    prompt: assetsStep.prompt,
    tools: defs,
    options: { characters: PROBE_CHARACTERS, scenes: PROBE_SCENES, hasExistingBreakdown: true },
    timeoutMs: Number(process.env.PROBE_ASSETS_TIMEOUT_MS || 420_000),
    maxTurns: Number(process.env.PROBE_ASSETS_TURNS || 12),
  });
  const a2 = r2.stubState.assetPromptAttempts;
  const complete2 = a2.filter((a) => a.known && a.promptChars > 0 && a.mjPromptChars > 0);
  const conform2 = complete2.filter(
    (a) => a.zhHits.length === a.zhTotal && a.mjHits.length === a.mjTotal && a.asciiRatio >= 0.9,
  );
  const expected2 = [...PROBE_CHARACTERS, ...PROBE_SCENES].map((a) => a.id);
  const covered2 = new Set(complete2.map((a) => a.id));
  const missing2 = expected2.filter((id) => !covered2.has(id));

  const r3 = await runAgentLoop({
    prompt: promptsStep.prompt,
    tools: defs,
    options: { characters: PROBE_CHARACTERS, scenes: PROBE_SCENES, shots: PROBE_SHOTS, hasExistingBreakdown: true },
    timeoutMs: Number(process.env.PROBE_SHOTPROMPTS_TIMEOUT_MS || 420_000),
    maxTurns: Number(process.env.PROBE_SHOTPROMPTS_TURNS || 12),
  });
  const batches3 = r3.stubState.promptBatches.filter((b) => !b.error);
  const expected3 = PROBE_SHOTS.map((s) => s.shotNo);
  const covered3 = new Set(batches3.flatMap((b) => b.shotNos || []));
  const missing3 = expected3.filter((n) => !covered3.has(n));
  const withVideo3 = batches3.reduce((n, b) => n + (b.withVideo || 0), 0);
  const sectionHits = new Set(batches3.flatMap((b) => b.universalSectionHits || []));
  const legacyHdr = batches3.reduce((n, b) => n + (b.legacyHeaderCount || 0), 0);
  const structure3 = withVideo3 === 0
    ? '未写入，无法判定'
    : sectionHits.size > 0
      ? `新版六段式（命中 ${sectionHits.size}/${UNIVERSAL_SECTION_HEADERS.length} 个段落标题）`
      : legacyHdr > 0
        ? `经典版标题（${legacyHdr} 条命中）`
        : '两种特征都没命中（需人工看原文）';

  return {
    pass: missing2.length === 0 && missing3.length === 0 && withVideo3 >= expected3.length,
    detail: {
      '第 2 步提示词字符数': assetsStep.prompt.length,
      '第 3 步提示词字符数': promptsStep.prompt.length,
      '对照：独立版④提示词字符数': h.prompts.buildShotPromptsPrompt('', template).length,
      '第 3 步模板': template,
      '第 2 步 · 资产覆盖': `${covered2.size}/${expected2.length}`,
      '第 2 步 · 格式合规': complete2.length ? `${conform2.length}/${complete2.length}` : '未写入',
      '第 2 步 · 各轮工具调用': turnTrace(r2),
      '第 2 步 · 结束原因': r2.terminatedBy,
      '第 3 步 · 分镜覆盖': `${covered3.size}/${expected3.length}`,
      '第 3 步 · 含 videoPrompt 条数': withVideo3,
      '第 3 步 · 实际写出的结构': structure3,
      '第 3 步 · 结构是否符合所选模板': withVideo3 === 0
        ? '—'
        : (template === 'universal') === (sectionHits.size > 0) ? '是' : '否',
      '第 3 步 · 各轮工具调用': turnTrace(r3),
      '第 3 步 · 结束原因': r3.terminatedBy,
      '总耗时(ms)': totalMs(r2) + totalMs(r3),
    },
    artifact: {
      steps: [
        { id: assetsStep.id, prompt: assetsStep.prompt },
        { id: promptsStep.id, prompt: promptsStep.prompt },
      ],
      loop2: r2,
      loop3: r3,
    },
  };
};

/**
 * 图片模块：打真实 multipart 生图请求（应用同款表单字段），
 * 并把返回的 base64 落盘成可肉眼验收的成图。
 */
MODULES.image = async () => {
  const IMG = (process.env.PROBE_IMG_BASE || 'http://127.0.0.1:7865').replace(/\/+$/, '');
  const IMG_MODEL = process.env.PROBE_IMG_MODEL || '/gpu/nfs/raymodel/Qwen/Qwen-Image-Edit-2509';
  const REF = process.env.PROBE_IMG_REF || path.join(here, '../../public/logo-char.png');
  const IMG_TIMEOUT_MS = Number(process.env.PROBE_IMG_TIMEOUT_MS || 360_000);
  const PROMPT = '复刻参考图中的人物形象，保持人脸、发型、服饰高度一致。中景，柔和冷色顶光，电影感构图，纯色浅灰背景，无文字无水印。';
  const outDir = path.join(here, '.gen/output');
  fs.mkdirSync(outDir, { recursive: true });

  const models = await (async () => {
    try {
      const res = await fetch(`${IMG}/v1/models`, { signal: AbortSignal.timeout(15_000) });
      return { status: res.status, body: (await res.text()).slice(0, 160).replace(/\s+/g, ' ') };
    } catch (e) { return { status: 0, body: String(e.message || e) }; }
  })();

  const form = new FormData();
  form.append('model', IMG_MODEL);
  form.append('prompt', PROMPT);
  form.append('n', '1');
  form.append('image', new Blob([fs.readFileSync(REF)], { type: 'image/png' }), path.basename(REF));

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), IMG_TIMEOUT_MS);
  const t0 = Date.now();
  let status = 0;
  let bodyText = '';
  let error = null;
  try {
    const res = await fetch(`${IMG}/v1/images/edits`, { method: 'POST', body: form, signal: ac.signal });
    status = res.status;
    bodyText = await res.text();
  } catch (e) {
    error = e.name === 'AbortError' ? `超时中断（${IMG_TIMEOUT_MS}ms）` : String(e.message || e);
  } finally {
    clearTimeout(timer);
  }
  const totalMs = Date.now() - t0;

  let saved = null;
  let payloadKind = '（无有效载荷）';
  let payloadBytes = 0;
  try {
    const parsed = JSON.parse(bodyText);
    const item = parsed?.data?.[0];
    const b64 = item?.b64_json;
    if (b64) {
      const buf = Buffer.from(b64, 'base64');
      payloadBytes = buf.length;
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      saved = path.join(outDir, `image-step-proof.${isJpeg ? 'jpg' : 'png'}`);
      fs.writeFileSync(saved, buf);
      payloadKind = `b64_json → ${path.basename(saved)}`;
    } else if (item?.url) {
      payloadKind = `url（未下载）：${String(item.url).slice(0, 80)}`;
    }
  } catch (e) {
    payloadKind = `非 JSON 响应：${bodyText.slice(0, 160).replace(/\s+/g, ' ')}`;
  }

  return {
    pass: status === 200 && Boolean(saved),
    detail: {
      '图片服务': `${IMG}/v1/images/edits`,
      '模型': IMG_MODEL,
      '参考图': path.relative(path.join(here, '../..'), REF),
      'GET /v1/models': models.status,
      'POST multipart': status,
      '耗时(ms)': totalMs,
      '响应载荷': payloadKind,
      '成图字节数': payloadBytes,
      '成图路径': saved ? path.relative(path.join(here, '../..'), saved) : '—',
      '错误': error ?? '—',
      '说明': '表单字段与应用 imageGen/client.ts 的 submitImageEditMultipart 一致（model/prompt/n/image）。',
    },
    artifact: { prompt: PROMPT, model: IMG_MODEL, reference: REF, status, saved, totalMs },
  };
};

// ── 执行 ─────────────────────────────────────────────────────────────
const target = process.argv.slice(2).join(' ') || 'all';
const names = target === 'all' ? Object.keys(MODULES) : target.split(/[,\s]+/).filter(Boolean);
const unknown = names.filter((n) => !MODULES[n]);
if (unknown.length) {
  console.error(`未知模块: ${unknown.join(', ')}。可选: ${Object.keys(MODULES).join(', ')}, all`);
  process.exit(2);
}

console.log(`目标服务 : ${BASE}`);
console.log(`模型     : ${MODEL}`);
console.log(`密钥     : ${KEY ? `已提供（${KEY.length} 字符）` : '未提供（用 PROBE_KEY 传入）'}`);
console.log(`工具集   : ${defs.length} 个可见 / ${defs.reduce((n, d) => n + JSON.stringify(d).length, 0)} 字符定义`);
console.log('');

const report = { base: BASE, model: MODEL, startedAt: new Date().toISOString(), modules: [] };
// 逐模块落盘：单跑某个模块不会把上一轮全量扫的汇总结果冲掉。
// 汇总 report.json 只反映**本次**调用，逐模块结果才是可长期比对的事实源。
const resultsDir = path.join(here, '.gen/results');
fs.mkdirSync(resultsDir, { recursive: true });

for (const name of names) {
  console.log(`▶ ${name} …`);
  let r;
  try {
    r = await MODULES[name]();
  } catch (e) {
    r = { pass: false, detail: { 异常: String(e?.stack || e) } };
  }
  // 基础设施重试信息：从 artifact 里的 loop 对象上收集，统一插到详情最前面。
  // 这样每个模块都能看出「这次结果是重试几次才拿到的」——网关可用率只有 37%–57%，
  // 不标出来就无法判断一个 pass 是稳的还是运气好。
  const infraLines = [];
  const scanLoop = (obj, tag) => {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.infraAttempts)) return;
    const tries = obj.infraAttempts.length;
    infraLines.push(`${tag}${tries > 1 ? `重试 ${tries} 次后` : '1 次'}`
      + `${obj.infraExhausted ? '（已耗尽，仍未拿到有效响应）' : ''}`);
  };
  if (r.artifact) {
    scanLoop(r.artifact.loop, '');
    scanLoop(r.artifact.loop2, '第2步 ');
    scanLoop(r.artifact.loop3, '第3步 ');
  }
  if (infraLines.length) {
    r.detail = { '基础设施重试': infraLines.join('；'), ...(r.detail || {}) };
  }
  const entry = {
    module: name,
    pass: r.pass ?? null,
    detail: r.detail,
    base: BASE,
    model: MODEL,
    ranAt: new Date().toISOString(),
  };
  report.modules.push({ module: name, pass: r.pass ?? null, detail: r.detail });
  fs.writeFileSync(path.join(resultsDir, `${name}.json`), JSON.stringify(entry, null, 1));
  const mark = r.pass === true ? '通过' : r.pass === false ? '未通过' : '—';
  console.log(`  [${mark}]`);
  for (const [k, v] of Object.entries(r.detail || {})) console.log(`      ${k}: ${v}`);
  if (r.artifact) {
    const dir = path.join(here, '.gen/artifacts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(r.artifact, null, 1));
  }
  console.log('');
}

report.finishedAt = new Date().toISOString();
fs.mkdirSync(path.join(here, '.gen'), { recursive: true });
fs.writeFileSync(path.join(here, '.gen/report.json'), JSON.stringify(report, null, 1));
console.log('报告已写入 scripts/pipeline-probe/.gen/report.json');
console.log('逐模块结果已写入 scripts/pipeline-probe/.gen/results/');
