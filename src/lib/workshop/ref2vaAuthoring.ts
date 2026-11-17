/** Structured workshop rewrites reconstruct a shot; free-form callers retain their input. */
export function ref2vaSourceText(input: { factualContext?: string; prompt: string; rewriteMode?: 'reconstruct' | 'edit' }): string {
  if (input.rewriteMode === 'reconstruct' && input.factualContext?.trim()) {
    return `CANONICAL FACTS (reconstruct this shot from these records and the attached references; no previous draft is supplied):\n${input.factualContext.trim()}`;
  }
  return `${input.factualContext?.trim() ? `CANONICAL FACTS:\n${input.factualContext.trim()}\n\n` : ''}USER-SUPPLIED SHOT DESCRIPTION (preserve its explicit facts and instructions):\n${input.prompt}`;
}

/** Editorial feedback only; never truncate speech, references or physical action. */
export function ref2vaEconomyFeedback(prompt: string, duration: number, referenceCount: number): string[] {
  const body = prompt.replace(/<d\s*>[\s\S]*?<\/d\s*>/giu, '');
  const wordCount = body.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  // A ceiling for an editorial pass, not a minimum length or an API rejection.
  // Longer clips and larger casts receive more room; exact dialogue is exempt.
  const budget = 140 + Math.max(1, referenceCount) * 35 + Math.max(4, duration) * 25;
  if (wordCount <= budget) return [];
  return [`EDITORIAL COMPACTION: ${wordCount} non-dialogue words for this ${duration}s shot. Aim below approximately ${budget} words, preserving every required action, timing, reference binding and exact speech turn. Define appearance once; retention_analysis lists only preservation categories or actual changes, not another appearance inventory. Remove repeated scene furnishing and prevention clauses. Do not shorten by deleting dialogue, causal transitions or ending state. This is one editorial pass, not a length quota.`];
}
