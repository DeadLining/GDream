import { isNonReferenceEdgeData } from './referencePolicy.ts';
interface FlowNode { id: string; type?: string; data: { description?: string; generatedContent?: string; lineageLabel?: string; title?: string } }
interface FlowEdge { source: string; target: string; data?: unknown }
export interface TextInputReference { nodeId: string; label: string; content: string; status: 'included' | 'duplicate' | 'empty' }
/** Shared projection for reference cards, preview and submission; no state writes. */
export function projectTextInputs(target: string, own: string, nodes: FlowNode[], edges: FlowEdge[]): {prompt: string; references: TextInputReference[]} {
  const inputs = [own.trim()];
  const references: TextInputReference[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.target !== target || edge.source === target || seen.has(edge.source) || isNonReferenceEdgeData(edge.data)) continue;
    const source = nodes.find(n => n.id === edge.source && n.type === 'text');
    if (!source) continue;
    seen.add(source.id);
    const content = source.data.generatedContent || source.data.description || '';
    const text = content.trim();
    const status = !text ? 'empty' : inputs.includes(text) ? 'duplicate' : 'included';
    references.push({nodeId:source.id,label:source.data.lineageLabel || source.data.title || `文本 ${references.length + 1}`,content,status});
    if (status === 'included') inputs.push(text);
  }
  return {prompt:inputs.filter(Boolean).join('\n\n'),references};
}
/** Only direct text inputs are merged; never follow provenance links or recursively traverse a graph. */
export function composeNodePrompt(target: string, own: string, nodes: FlowNode[], edges: FlowEdge[]): string {
  return projectTextInputs(target, own, nodes, edges).prompt;
}
