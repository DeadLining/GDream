export interface WorkshopBreakdownSchemaContext {
  /** The project already has a synopsis/episodes/characters/scenes/props. */
  hasExistingBreakdown: boolean;
  /** Source script files are attached to the project. */
  hasSourceMaterial: boolean;
}

/**
 * The runtime contract for `workshop_set_breakdown` differs by project state:
 * the first breakdown must submit the full Scene → Beat → entity structure, but
 * a later re-analysis of an existing breakdown is a partial update that must
 * only restate `synopsis`. Keeping this as a pure function lets the advertised
 * JSON schema and the executor agree without weakening the partial-update path.
 */
export function workshopBreakdownRequiredFields(
  context: WorkshopBreakdownSchemaContext,
): string[] {
  const base = ['synopsis'];
  if (context.hasExistingBreakdown) return base;
  const full = [...base, 'episodes', 'narrativeBeats', 'characters', 'scenes'];
  if (context.hasSourceMaterial) full.push('sourceEvidence');
  return full;
}
