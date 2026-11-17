import type { Edge, Node } from 'reactflow';

/** View-only grouping. Never persist these endpoints or use them for generation. */
export function projectFrameComparisons(nodes: Node[], edges: Edge[], expanded: ReadonlySet<string>) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const pairs = new Map<string, Node>();
  const aliases = new Map<string, string>();
  for (const edge of edges) {
    const receipt = edge.data?.mediaProvenance;
    if (edge.data?.relation !== 'provenance' || receipt?.operation !== 'extract' || receipt.position !== 'last') continue;
    const actual = byId.get(edge.target);
    const video = byId.get(edge.source);
    if (!video || !actual || actual.type !== 'image' || !actual.data.lineageManaged || actual.data.isGenerating
      || expanded.has(actual.id) || actual.hidden || actual.parentNode
      || video?.data.localPath !== receipt.sourcePath || actual.data.localPath !== receipt.outputPath) continue;
    const inputs = edges.filter(e => e.target === video.id && e.data?.lineage
      && String(e.data.lineageRelation).startsWith('video-') && /尾帧$/.test(String(e.data.lineageLabel)));
    const tails = edges.filter(e => e.source === video.id && e.data?.relation === 'provenance'
      && e.data.mediaProvenance?.operation === 'extract' && e.data.mediaProvenance?.position === 'last');
    if (inputs.length !== 1 || tails.length !== 1) continue;
    const planned = byId.get(inputs[0].source);
    if (!planned || planned.type !== 'image' || !planned.data.lineageManaged || planned.selected
      || planned.hidden || planned.parentNode || planned.data.isGenerating || actual.id === planned.id
      || !planned.data.generatedImageUrl || !actual.data.generatedImageUrl
      || aliases.has(planned.id) || pairs.has(planned.id) || aliases.has(actual.id)) continue;
    pairs.set(actual.id, planned);
    aliases.set(planned.id, actual.id);
  }
  return {
    nodes: nodes.map(node => {
      if (aliases.has(node.id)) return {...node, hidden: true};
      const planned = pairs.get(node.id);
      return planned ? {...node, type: 'frameComparison', data: {...node.data, comparisonPlanned: {
        id: planned.id, url: planned.data.generatedImageUrl, usages: planned.data.referenceUsages ?? [],
      }}} : node;
    }),
    edges: edges.map(edge => {
      const source = aliases.get(edge.source);
      const target = aliases.get(edge.target);
      return source || target ? {...edge,
        ...(source ? {source, sourceHandle:'planned-out'} : {}),
        ...(target ? {target, targetHandle:'planned-in'} : {}),
      } : edge;
    }),
  };
}
