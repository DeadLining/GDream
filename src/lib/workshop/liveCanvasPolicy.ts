export function canSyncWorkshopCanvas(linked: string | undefined, active: string | null, switching: boolean): boolean {
  return Boolean(linked && linked === active && !switching);
}
export interface CanvasAssetVersion {
  path: string;
  createdAt: number;
  prompt?: string;
  candidateId?: string;
  checksum?: string;
  source?: string;
}
/** Immutable result history, including candidates not yet adopted by the workshop. */
export function mergeCanvasVersions(previous: CanvasAssetVersion[], candidates: CanvasAssetVersion[], selected?: string): CanvasAssetVersion[] {
  const byPath = new Map(previous.map((v) => [v.path, v]));
  for (const version of candidates) {
    if (version.path) byPath.set(version.path, { ...byPath.get(version.path), ...version });
  }
  if (selected && !byPath.has(selected)) byPath.set(selected, { path: selected, createdAt: 0, source: 'existing' });
  return [...byPath.values()].sort((a, b) => a.createdAt - b.createdAt);
}
