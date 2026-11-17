import { BaseDirectory, readTextFile, exists } from '@tauri-apps/api/fs';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { nanoid } from 'nanoid';
import type { Tool, AgentUserContentBlock } from '../types';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useProjectStore } from '@/stores/projectStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { adMaterialsFingerprint } from '@/lib/workshop/adMaterials';
import { parseAdResearchSelection, upsertAdResearchNodes } from '@/lib/workshop/adResearchCanvas';
import { saveAdImage } from '@/lib/workshop/adMaterialFiles';

export const adResearchCanvasTool: Tool = {
  definition: {
    name:'workshop_publish_ad_research',
    description:'将 DSH 已搜索、阅读并筛选的广告资料和图片保存到当前项目及关联画布。不是再次搜索：sources 填本轮工具证据的摘录/总结及来源，images 只填选中的公网参考图。按来源 URL 幂等更新，不复制全量搜索结果；所有节点为待核实/待确认的调研参考，不绑定产品身份、不连接分镜、不触发生成。需先准备广告资料且当前画布与工坊项目一致。成功回执表示两处保存已核对，不表示事实、图片或商用授权获批准。',
    parameters:{type:'object',properties:{
      sources:{type:'array',description:'最多 10 条筛选资料',items:{type:'object',properties:{url:{type:'string'},title:{type:'string'},content:{type:'string',description:'已读取证据的摘录或明确的总结，不编造来源内容'},reason:{type:'string',description:'为什么与本产品和广告相关'}},required:['url','title','content','reason']}},
      images:{type:'array',description:'最多 6 张筛选参考图',items:{type:'object',properties:{url:{type:'string'},reason:{type:'string',description:'图片用途及选择理由；不得直接认定产品身份'}},required:['url','reason']}},
    },required:[]},
  },
  risk:'safe',
  async execute(params,signal) {
    let projectSaved=false;
    try {
      const selection=parseAdResearchSelection(params);
      const start=useWorkshopStore.getState();const projectId=start.project?.id;
      const spec=start.data?.creativeSpec;const ad=spec?.adSpec;const materials=ad?.materials;
      const canvasId=useProjectStore.getState().activeProjectId;
      if(!projectId || spec?.workKind!=='product-ad' || !ad || !materials || materials.fingerprint!==adMaterialsFingerprint(ad)) throw new Error('请先调用 workshop_prepare_ad_materials 准备当前产品资料，再筛选入画布');
      const assertCurrent=()=>{
        signal?.throwIfAborted();
        const ws=useWorkshopStore.getState(), ps=useProjectStore.getState();
        if(ws.project?.id!==projectId || ws.data?.projectId!==projectId || ws.data.creativeSpec?.workKind!=='product-ad' || !ws.data.creativeSpec?.adSpec || adMaterialsFingerprint(ws.data.creativeSpec.adSpec)!==materials.fingerprint) throw new Error('广告项目或产品设置已变化，已停止同步');
        if(!canvasId || ps.switching || ps.activeProjectId!==canvasId || ws.data.canvasProjectId!==canvasId || !ps.projects.some(p=>p.id===canvasId && p.aigcProjectId===projectId)) throw new Error('当前画布与广告项目不一致，请先打开该项目画布后重试；不会写入其他项目');
      };
      assertCurrent();
      const images=[...materials.images];const media:AgentUserContentBlock[]=[];
      for(const image of selection.images){
        const existing=images.find(i=>i.url===image.url);
        if(existing){
          if(!await exists(existing.path)) throw new Error('已保存参考图文件缺失，请重新准备图片后重试');
          assertCurrent();continue;
        }
        if(materials.mode!=='online' || !useSettingsStore.getState().webSearchEnabled) throw new Error('未获联网许可，不能下载新的网络参考图');
        const saved=await saveAdImage(projectId,image.url,signal);assertCurrent();
        images.push({url:image.url,path:saved.path,purpose:'inspiration'});media.push(saved.media);
      }
      assertCurrent();
      const before=useWorkshopStore.getState();
      if(before.data!.creativeSpec!.adSpec!.materials!==materials) throw new Error('调研资料已被其他操作更新，请重新读取后筛选');
      const sourceMap=new Map(materials.sources.map(s=>[s.url,s]));
      for(const source of selection.sources) sourceMap.set(source.url,{url:source.url,title:source.title,content:source.content});
      const record={...materials,sources:[...sourceMap.values()],images,
        curatedSourceUrls:[...new Set([...(materials.curatedSourceUrls??[]),...selection.sources.map(s=>s.url)])],
        curatedImageUrls:[...new Set([...(materials.curatedImageUrls??[]),...selection.images.map(s=>s.url)])],
      };
      useWorkshopStore.setState({data:{...before.data!,creativeSpec:{...before.data!.creativeSpec!,adSpec:{...before.data!.creativeSpec!.adSpec!,materials:record}}}});
      try {await useWorkshopStore.getState().commitNow();} catch(error){
        const now=useWorkshopStore.getState();
        if(now.project?.id===projectId && now.data?.creativeSpec?.adSpec?.materials===record) useWorkshopStore.setState({data:{...now.data,creativeSpec:{...now.data.creativeSpec,adSpec:{...now.data.creativeSpec.adSpec,materials}}}});
        throw error;
      }
      projectSaved=true;assertCurrent();
      const result=upsertAdResearchNodes(useCanvasStore.getState().nodes,projectId,selection,images,convertFileSrc,()=>`ad-research-${nanoid(10)}`);
      useCanvasStore.getState().setNodes(result.nodes);
      await useProjectStore.getState().flushActiveCanvas();assertCurrent();
      // The legacy canvas writer logs IO errors; read back so it cannot produce a false success receipt.
      const persisted=JSON.parse(await readTextFile(`.gdream/projects/${canvasId}/canvas.json`,{dir:BaseDirectory.Home}));
      assertCurrent();
      for(const id of result.nodeIds){
        const expected=result.nodes.find(n=>n.id===id)!;
        const actual=persisted.nodes?.find((n:{id:string})=>n.id===id);
        if(!actual || JSON.stringify(actual.data)!==JSON.stringify(expected.data)) throw new Error('画布保存回读不一致，可用相同筛选参数重试，不会重复创建节点');
      }
      return {success:true,output:JSON.stringify({projectId,canvasProjectId:canvasId,nodeIds:result.nodeIds,sourceCards:selection.sources.length,imageNodes:selection.images.length,status:'参考资料已保存到项目和画布；未确认采用、产品身份或授权，未触发生成'}),media};
    } catch(error) {
      return {success:false,output:projectSaved?'资料已保存到项目，但画布同步尚未确认成功；可用相同参数重试。':'',error:error instanceof Error?error.message:'广告调研入画布失败'};
    }
  },
};
