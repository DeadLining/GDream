/** Persisted evidence; never infer provenance from filenames, shot order or pixel similarity. */
export interface MediaProvenance {
  sourcePath: string;
  outputPath: string;
  operation: 'extract' | 'edit' | 'image-reference';
  evidence: string;
  timeSec?: number;
  frameIndex?: number;
  position?: 'last';
  description?: string;
}
interface ShotEvidence {
  videoPath?: string;
  acceptedVideoTail?: { videoPath: string; framePath?: string; extractionId: string };
  videoStartFrameInheritance?: { videoPath: string; framePath: string; shotNo: string };
  videoStartFramePath?: string;
  videoEndFramePath?: string;
  videoStartFrameReferencePaths?: string[];
  videoEndFrameReferencePaths?: string[];
}
export function collectMediaProvenance(shots: ShotEvidence[], saved: unknown[] = []): MediaProvenance[] {
  const records = new Map<string, MediaProvenance>();
  const add = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const r = value as MediaProvenance;
    if (typeof r.sourcePath !== 'string' || !r.sourcePath.trim() || typeof r.outputPath !== 'string' || !r.outputPath.trim()
      || r.sourcePath === r.outputPath || !['extract','edit','image-reference'].includes(r.operation)
      || typeof r.evidence !== 'string' || !r.evidence.trim()) return;
    records.set(`${r.sourcePath}\0${r.outputPath}\0${r.operation}`, r);
  };
  for (const shot of shots) {
    const tail = shot.acceptedVideoTail;
    if (tail?.framePath) add({sourcePath:tail.videoPath,outputPath:tail.framePath,operation:'extract',position:'last',evidence:`acceptedVideoTail:${tail.extractionId}`});
    const inherited = shot.videoStartFrameInheritance;
    if (inherited) add({sourcePath:inherited.videoPath,outputPath:inherited.framePath,operation:'extract',position:'last',evidence:`videoStartFrameInheritance:${inherited.shotNo}`});
    for (const [outputPath, inputs] of [[shot.videoStartFramePath,shot.videoStartFrameReferencePaths],[shot.videoEndFramePath,shot.videoEndFrameReferencePaths]] as const) {
      if (!outputPath || outputPath === tail?.framePath || outputPath === inherited?.framePath) continue;
      for (const sourcePath of inputs ?? []) add({sourcePath,outputPath,operation:'image-reference',evidence:'saved-boundary-reference-paths'});
    }
  }
  for (const record of saved) add(record);
  return [...records.values()];
}
export function provenanceLabel(r: MediaProvenance): string {
  if (r.operation === 'extract') return r.position === 'last' ? `提取成片末帧${Number.isFinite(r.frameIndex) ? ` · 帧索引 ${r.frameIndex}` : ''}${Number.isFinite(r.timeSec) ? ` @${r.timeSec}s` : ''}` : Number.isFinite(r.frameIndex) ? `提取第 ${r.frameIndex} 帧` : Number.isFinite(r.timeSec) ? `取帧 @${r.timeSec}s` : '视频抽帧（时间未记录）';
  return r.operation === 'edit' ? `图片处理${r.description ? ` · ${r.description}` : ''}` : '生图参考来源';
}
