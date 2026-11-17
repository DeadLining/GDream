import type { Edge, Node } from 'reactflow';

/** Merge only system-owned duplicate shot outputs; never discard media versions. */
export function reconcileHandoffNodes(nodes: Node[], edges: Edge[], projectId: string) {
  const groups = new Map<string, Node[]>();
  for (const node of nodes) {
    const ref = node.data.workshopRef;
    if (ref?.projectId !== projectId || ref.kind !== 'shot' || !['shot-video', 'shot-image'].includes(ref.role)) continue;
    if (!node.data.lineageManaged && !node.id.startsWith(`node-ws-${projectId}-`)) continue;
    const counterpart = nodes.find(n => {
      const other = n.data.workshopRef;
      return n.data.lineageManaged && other?.projectId === projectId && other.kind === 'shot'
        && other.role === ref.role && (other.id === ref.id || (ref.shotId && other.shotId === ref.shotId));
    });
    const canonicalRef = counterpart?.data.workshopRef ?? ref;
    const key = `${ref.role}:${canonicalRef.shotId || canonicalRef.id}`;
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  const aliases = new Map<string, string>();
  const merged = new Map<string, Node>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const canonical = group.find(n => n.data.lineageManaged) ?? group[0];
    const versions = new Map<string, Record<string, unknown>>();
    const history = new Map<string, Record<string, unknown>>();
    for (const node of group) {
      for (const item of node.data.generationHistory ?? []) history.set(item.url, item);
      for (const version of node.data.assetVersions ?? []) versions.set(version.path, version);
      if (node.data.localPath && !versions.has(node.data.localPath)) versions.set(node.data.localPath, {path:node.data.localPath,createdAt:0,source:'canvas'});
      if (node !== canonical) aliases.set(node.id, canonical.id);
    }
    merged.set(canonical.id, {...canonical,data:{...canonical.data,assetVersions:[...versions.values()],generationHistory:[...history.values()]}});
  }
  return {
    nodes: nodes.filter(n => !aliases.has(n.id)).map(n => merged.get(n.id) ?? n),
    edges: edges.map(e => ({...e,source:aliases.get(e.source) ?? e.source,target:aliases.get(e.target) ?? e.target})).filter(e => e.source !== e.target),
  };
}

/** Preserve existing/manual layouts. New ungrouped nodes find free vertical space. */
export function placeNewHandoffNodes(nodes: Node[], existingIds: Set<string>): Node[] {
  const placed = nodes.filter(n => existingIds.has(n.id));
  const size = (n: Node) => ({w:Number(n.width || n.style?.width) || 320,h:Number(n.height || n.style?.height) || 220});
  const collides = (a:Node,b:Node) => {
    if (a.parentNode !== b.parentNode) return false;
    const x=size(a),y=size(b);
    return a.position.x < b.position.x+y.w+24 && a.position.x+x.w+24 > b.position.x
      && a.position.y < b.position.y+y.h+24 && a.position.y+x.h+24 > b.position.y;
  };
  const result = new Map<string,Node>();
  for (const original of nodes) {
    if (existingIds.has(original.id)) {result.set(original.id,original);continue;}
    const node = {...original,position:{...original.position}};
    let conflict:Node|undefined;
    while ((conflict=placed.find(n=>collides(node,n)))) node.position.y=conflict.position.y+size(conflict).h+24;
    placed.push(node);result.set(node.id,node);
  }
  return nodes.map(n=>result.get(n.id)!);
}
