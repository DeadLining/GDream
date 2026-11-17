import { ref2vaSourceText, ref2vaEconomyFeedback } from './ref2vaAuthoring';
import type { RewriteMiniMaxH3ShotPromptInput } from './workshopPrompts';
import { alignRef2vaSubjectNumbering, assertRef2vaTimingResolved, sortRef2vaSubjectDefinitions, auditRef2vaPrompt, bindRef2vaVoiceIds, canonicalizeRef2vaSpeakerBindings, ensureRef2vaDialogueTags, ref2vaDialogueLedger, foldRef2vaAuxiliaryLabels, ref2vaPreviousShotReferenceInstruction, H3_REF2VA_SKILL, H3_REF2VA_OUTPUT_CONTRACT, normalizeRef2vaDialogue, ref2vaStructureIssues, stripRef2vaAuthoringAppendix } from './h3Ref2vaPrompt';
import { H3_SHOT_CONTRACT_AUTHORING_EN, auditH3ShotContract } from './h3ShotContract';
import { assertShotTimingFits, H3_FLEXIBLE_TIMING_EN, readH3TimedPrompt, resolveShotTiming, shotTimingAdviceEn, SINGLE_TIMELINE_MAX_SEC } from './shotTimingPolicy';

/** Separate Ref2VA authoring route. No I2VA boundary repair or eight-section injection. */
export async function rewriteRef2vaPrompt(input: RewriteMiniMaxH3ShotPromptInput, options: { signal?: AbortSignal; onProgress?: (status: string) => void; onDurationResolved?: (seconds: number) => void } = {}): Promise<string> {
  const timing = resolveShotTiming({ durationSec: input.duration, dialogue: input.dialogue, minimumDurationSec: input.minimumDurationSec });
  assertShotTimingFits(timing);
  const minimumDuration = timing.minimumSeconds;
  let duration = timing.effectiveSeconds;
  const counts = { Picture: 0, Audio: 0, Video: 0 };
  const imagePaths: string[] = [];
  const refs = input.references.map((reference) => {
    const kind = reference.kind === '音频' ? 'Audio' : reference.kind === '视频' ? 'Video' : 'Picture';
    const number = ++counts[kind];
    if (kind === 'Picture') {
      if (!reference.path) {
        throw new Error(`参考图“${reference.label}”没有实际文件，未重写或保存提示词。`);
      }
      imagePaths.push(reference.path);
    }
    return `<${kind} ${number}>: ${reference.label}`;
  }).join('\n');
  if (counts.Picture === 0) {
    throw new Error('Ref2VA 重写缺少实际参考图片，未重写或保存提示词。');
  }

  const messages = [
    { role: 'system', content: H3_REF2VA_SKILL + '\n' + H3_REF2VA_OUTPUT_CONTRACT + '\nReturn only the complete usable prompt in the canonical six-field format, no Markdown fences or authoring appendix. Only for genuinely incompatible hard timing constraints use the standalone REF2VA_TIMING_UNRESOLVED response defined in the skill. The canonical script determines exact dialogue ownership. Write unfolding audiovisual events, not a compliance checklist. Preserve explicit user constraints concisely and let the shot land on its planned visible result or hold.' },
    { role: 'user', content: `Ref2VA, reference duration ${duration} seconds, ${input.ratio || '16:9'}. Feasible effective duration: ${minimumDuration}-${SINGLE_TIMELINE_MAX_SEC} seconds.
${shotTimingAdviceEn(timing)}
${H3_FLEXIBLE_TIMING_EN}
REFERENCE ORDER (the attached images are in exactly this Picture order):\n${refs}
Inspect the attached native images in order, then bind stable reference roles.
REFERENCE ROLES: character images give identity and appearance; scene images give environment and layout; prop images give object appearance and proportions. Treat reference crop size as asset information and frame according to the action. ${ref2vaPreviousShotReferenceInstruction(input.references, input.previousTailReferencePath, input.previousShotContext, input.previousTailAsFirstFrame)}
SUBJECTS: establish compact reference bindings once inside subject_definitions, not a repeated appearance catalogue. For dialogue, use a line like <Subject N> (canonical name): reference role, with one label per physical person. Number speaking people in first-speaking order and reuse stable (Sx) voice ids beside their lines. Give non-speaking props or environments labels only when useful. The preceding tail and other references describe the same cast, not extra bodies.
SHOTS: detailed_description starts with [Shot 1], even for a single take. Additional [Shot N] blocks mean real internal cuts, with later cut times at the start of the block. Continue same-scene positions, facing, support, prop contact and momentum; follow this shot's staging when it starts a new composition.
SAME-SCENE PREVIOUS SHOT CONTINUITY (when supplied):
${input.previousShotContext || 'No same-scene predecessor was supplied.'}
When supplied, treat the previous structured state as history and continue with this shot's own action, following the reference policy above.
WRITING: preserve canonical facts and match detail to complexity. Write cause, action, contact or path and result where mechanics matter. Integrate dialogue delivery, listening, camera and sound into the event. Use timing only where it clarifies meaningful changes; reflow reference windows for natural speech and reactions. State identities and starting anchors once, then describe changes. Convey the chosen style through medium, materials, light, motion texture and sound.
CAMERA AND SPACE: the DIRECTOR INTENT for this shot already fixes the camera, shot size and viewpoint; realize that camera work, including every move named in it. Only choose framing details it leaves open, and keep elevated, aerial and grounded subjects physically credible together.
EYELINE AND FACING: for a direct look or address, state torso/chest and face direction rather than only the gaze, and keep the camera on the side where the face is visible.
${ref2vaSourceText(input)}
${H3_SHOT_CONTRACT_AUTHORING_EN}
EXACT DIALOGUE:\n${input.dialogue || 'No dialogue. No intelligible speech.'}
AUTHORITATIVE SPEECH TURNS (bind each speaker to the correct Subject and use requiredDialogueTag verbatim):
${ref2vaDialogueLedger(input.dialogue)}
When the ledger contains turns, place every requiredDialogueTag once in the event description beside its sole Subject and stable voice id, keeping the complete line, natural speaking pace and relevant listener response. Make an on-screen speaker identifiable; preserve explicitly off-screen voices as off-screen. Each turn keeps the language recorded in the ledger.
Preserve this shot's approved staging and realize its action timeline once, without repeating source prose.` },
  ];
  const complete = await (await import('./firstFrameRewriteChat')).createReferenceRewriteChat(imagePaths, options);
  // Order matters: bind each line to its speaker, align the subject numbering
  // with vocal order, then stamp `(Sx)`. The three then agree by construction.
  const clean = (text: string) => foldRef2vaAuxiliaryLabels(stripRef2vaAuthoringAppendix(sortRef2vaSubjectDefinitions(bindRef2vaVoiceIds(alignRef2vaSubjectNumbering(canonicalizeRef2vaSpeakerBindings(ensureRef2vaDialogueTags(
    normalizeRef2vaDialogue(text.trim().replace(/^```(?:text|markdown)?\s*/iu, '').replace(/\s*```$/iu, '')),
    input.dialogue,
  ), input.dialogue), input.dialogue)))));
  const timedResult = readH3TimedPrompt(await complete(messages), duration, minimumDuration);
  duration = timedResult.durationSeconds;
  let result = clean(timedResult.prompt);
  assertRef2vaTimingResolved(result);
  // An unresolved identity is not a formatting error: never ask the model to guess it away.
  if (result.includes('REFERENCE_BINDING_UNRESOLVED')) {
    throw new Error(`${ref2vaStructureIssues(result).join('；')}。未覆盖原提示词。`);
  }
  const structureIssues = ref2vaStructureIssues(result);
  const issues = [...structureIssues, ...(structureIssues.length ? [] : [
    ...auditRef2vaPrompt(result, input.dialogue, input.previousTailReferencePath, input.previousShotContext),
    ...auditH3ShotContract({
      prompt: result,
      dialogue: input.dialogue,
      durationSeconds: duration,
    }),
  ])];
  const editorial = ref2vaEconomyFeedback(result, duration, counts.Picture);
  if (issues.length > 0 || editorial.length > 0) {
    options.onProgress?.('正在检查并精简 H3 提示词（最多一次，不删除对白或动作事实）');
    const repairMessages = [
      ...messages,
      { role: 'user', content: `TARGETED REPAIR ONLY. The draft failed this preflight audit:
${[...issues, ...editorial].map((issue) => `- ${issue}`).join('\n')}
Return the complete usable prompt with only the reported issues corrected, using the canonical six-field format above. Restore missing fields, correct field order and consecutive [Shot N] labels without inventing content or changing the action. Preserve canonical facts, reference bindings, all speech turns and useful action mechanics. Keep event-led writing and do not append a checklist or repeat these instructions.
Apply editorial compaction when requested, without replacing visible action with static poses.
Effective duration: ${duration} seconds. Keep this resolved duration during content-only repair; do not accelerate or truncate dialogue. Prefix H3_EFFECTIVE_DURATION: ${duration} seconds.
AUTHORITATIVE SPEECH TURNS (insert each requiredDialogueTag verbatim in its timed turn):
${ref2vaDialogueLedger(input.dialogue)}
When the ledger contains turns, the repaired event description must contain every requiredDialogueTag exactly once; never replace supplied dialogue with "No dialogue", paraphrase it, or leave it only in EXACT DIALOGUE or the soundscape.
DRAFT TO REPAIR:\n${result}` },
    ];
    const timedRepair = readH3TimedPrompt(await complete(repairMessages), duration, minimumDuration);
    if (timedRepair.durationSeconds !== duration) throw new Error('定向修复改变了已确定时长，未覆盖原提示词。');
    result = clean(timedRepair.prompt);
    assertRef2vaTimingResolved(result);
    const remainingStructure = ref2vaStructureIssues(result);
    if (remainingStructure.length) throw new Error(`参考模式定向修复未通过：${remainingStructure.join('；')}。未覆盖原提示词。`);
    const remaining = [
      ...auditRef2vaPrompt(result, input.dialogue, input.previousTailReferencePath, input.previousShotContext),
      ...auditH3ShotContract({
        prompt: result,
        dialogue: input.dialogue,
        durationSeconds: duration,
      }),
    ];
    if (remaining.length > 0) throw new Error(`参考模式提示词未通过内容预检：${remaining.join('；')}。未覆盖原提示词。`);
  }
  options.onDurationResolved?.(duration);
  return result;
}
