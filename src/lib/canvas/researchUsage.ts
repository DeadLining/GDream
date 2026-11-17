import type {Node, Edge} from 'reactflow';

function referenceMatchesNode(ref: string, node: Node): boolean {
  const data = node.data as Record<string, unknown>;
  const refValues = new Set([ref.trim()]);
  if (ref.startsWith('asset://localhost/')) {
    try { refValues.add(decodeURIComponent(ref.slice('asset://localhost/'.length))); } catch { /* noop */ }
  }
  if (ref.startsWith('file://')) {
    try { refValues.add(decodeURIComponent(new URL(ref).pathname)); } catch { /* noop */ }
  }

  const candidates = [
    data.localPath,
    data.generatedImageUrl,
    data.generatedVideoUrl,
    data.referenceImage,
    data.sourceUrl,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return candidates.some((candidate) => {
    const candidateValues = new Set([candidate.trim()]);
    if (candidate.startsWith('asset://localhost/')) {
      try { candidateValues.add(decodeURIComponent(candidate.slice('asset://localhost/'.length))); } catch { /* noop */ }
    }
    return [...refValues].some((value) => candidateValues.has(value));
  });
}

/** Successful submitted reference list is the only authority; collection alone is not usage. */
export function researchUsageEdges(nodes: Node[], target: string, refs: string[], outputPath: string, receipt: string): Edge[] {
  if (!outputPath || !receipt || refs.length === 0) return [];
  return nodes.filter(n => n.id !== target && (n.data.adResearchProjectId || n.data.adResearchStatus)
    && refs.some(ref => referenceMatchesNode(ref, n)))
    .map(n => ({id:`research-used:${n.id}:${target}:${encodeURIComponent(outputPath)}`,source:n.id,target,type:'custom',
      data:{relation:'provenance',lineage:true,lineageLocked:true,lineageLabel:'已用于生成',
        mediaProvenance:{sourcePath:n.data.localPath || n.data.generatedImageUrl || n.data.referenceImage || n.data.sourceUrl,
          sourceUrl:n.data.sourceUrl, outputPath,operation:'media-reference',evidence:receipt}}}));
}
