import type { Node } from 'reactflow';
import type { AdMaterials } from './adMaterials';

export interface AdResearchSource { url: string; title: string; content: string; reason: string }
export interface AdResearchImage { url: string; reason: string }
export interface AdResearchSelection { sources: AdResearchSource[]; images: AdResearchImage[] }
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`文字字段不能为空且不能超过 ${max} 字符`);
  return value.trim();
}
function publicUrl(value: unknown): string {
  const valueText = text(value, 2048);
  const u = new URL(valueText);
  const hostname = u.hostname.replace(/\.$/, '');
  if (u.protocol !== 'https:' || u.username || u.password || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) throw new Error('来源和图片须使用不含凭证的公网 HTTPS 域名 URL');
  u.hash = '';
  return u.href;
}
export function parseAdResearchSelection(params: Record<string, unknown>): AdResearchSelection {
  const list = (value: unknown, max: number): Record<string, unknown>[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > max || value.some(v => !v || typeof v !== 'object' || Array.isArray(v))) throw new Error(`列表格式错误或超过 ${max} 项`);
    return value;
  };
  const sources = list(params.sources, 10).map(s => ({url:publicUrl(s.url),title:text(s.title,300),content:text(s.content,16000),reason:text(s.reason,1000)}));
  const images = list(params.images, 6).map(s => ({url:publicUrl(s.url),reason:text(s.reason,1000)}));
  if (!sources.length && !images.length) throw new Error('至少选择一条资料或一张参考图，不能把空结果写入画布');
  if (new Set(sources.map(s=>s.url)).size !== sources.length || new Set(images.map(s=>s.url)).size !== images.length) throw new Error('同类来源 URL 不得重复');
  return {sources,images};
}

/** No auto-connections, identity binding, or generation flags. Existing user layout is preserved. */
export function upsertAdResearchNodes(
  nodes: Node[], projectId: string, selection: AdResearchSelection,
  images: AdMaterials['images'], assetUrl: (path: string) => string, makeId: () => string,
): {nodes: Node[]; nodeIds: string[]} {
  const next = [...nodes];const nodeIds: string[]=[];
  const right = Math.max(0,...nodes.map(n=>n.position.x+(n.width ?? 360)))+80;
  let added=0;
  function upsert(key: string, type: string, data: Record<string,unknown>) {
    const index=next.findIndex(n=>n.data?.adResearchProjectId===projectId && n.data?.adResearchKey===key);
    if(index>=0){const old=next[index];next[index]={...old,data:{...old.data,...data}};nodeIds.push(old.id);return;}
    const id=makeId();next.push({id,type,position:{x:right+(added%3)*400,y:Math.floor(added/3)*420},style:{width:360,height:type==='image'?340:360},data:{...data,adResearchProjectId:projectId,adResearchKey:key}});added++;nodeIds.push(id);
  }
  for(const source of selection.sources) upsert(`source:${source.url}`,'text',{
    description:`广告调研 · ${source.title}（待核实）`,
    generatedContent:`# ${source.title}\n\n${source.content}\n\n采用理由：${source.reason}\n来源：${source.url}\n\n状态：DSH 筛选的参考资料，事实仍需核验；入画布不代表审核通过。`,
    sourceUrl:source.url,adResearchStatus:'reference',adResearchReason:source.reason,
  });
  for(const selected of selection.images){
    const image=images.find(i=>i.url===selected.url);if(!image)throw new Error('参考图尚未下载，不能创建空图片节点');
    upsert(`image:${selected.url}`,'image',{
      description:`广告参考图 · 待确认\n${selected.reason}\n来源：${selected.url}\n授权未确认；非产品身份图`,
      generatedImageUrl:assetUrl(image.path),localPath:image.path,isUploadedImage:true,
      sourceUrl:selected.url,adResearchStatus:'reference',adResearchReason:selected.reason,
    });
  }
  return {nodes:next,nodeIds};
}
