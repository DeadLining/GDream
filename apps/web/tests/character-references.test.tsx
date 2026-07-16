import {act,cleanup,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CharacterWorkspace} from '../components/CharacterWorkspace';
import {readAllStyles} from './_styles';

const mocks=vi.hoisted(()=>({
  list:vi.fn(),upload:vi.fn(),generateSet:vi.fn(),update:vi.fn(),activate:vi.fn(),deleteReference:vi.fn(),
  createCharacter:vi.fn(),updateCharacter:vi.fn(),
  retry:vi.fn(),pollJob:vi.fn(),variants:vi.fn(),
  libraryAssets:vi.fn(),createLibraryAsset:vi.fn(),updateLibraryAsset:vi.fn(),deleteLibraryAsset:vi.fn(),
  suggestVariant:vi.fn(),
  representations:vi.fn(),uploadRepresentation:vi.fn(),
  generateModel3D:vi.fn(),latestModel3D:vi.fn(),approveModel3D:vi.fn(),
  characterImpact:vi.fn(),variantImpact:vi.fn(),stateImpact:vi.fn(),createProductionRun:vi.fn(),
  createVariant:vi.fn(),createState:vi.fn(),updateVariant:vi.fn(),updateState:vi.fn(),deleteVariant:vi.fn(),deleteState:vi.fn(),
}));
vi.mock('../lib/api',()=>({
  listCharacterReferences:mocks.list,
  listAssetVariants:mocks.variants,
  listCharacter3DRepresentations:mocks.representations,
  createCharacter:mocks.createCharacter,
  updateCharacter:mocks.updateCharacter,
  listLibraryAssets:mocks.libraryAssets,
  createLibraryAsset:mocks.createLibraryAsset,
  updateLibraryAsset:mocks.updateLibraryAsset,
  deleteLibraryAsset:mocks.deleteLibraryAsset,
  uploadCharacterReference:mocks.upload,
  uploadCharacter3DRepresentation:mocks.uploadRepresentation,
  generateModel3D:mocks.generateModel3D,
  getLatestModel3DJob:mocks.latestModel3D,
  approveModel3DJob:mocks.approveModel3D,
  getCharacterImpact:mocks.characterImpact,
  getAssetVariantImpact:mocks.variantImpact,
  getAssetVariantStateImpact:mocks.stateImpact,
  createProductionRun:mocks.createProductionRun,
  generateCharacterReferenceSet:mocks.generateSet,
  updateCharacterReference:mocks.update,
  activateCharacterReference:mocks.activate,
  deleteCharacterReference:mocks.deleteReference,
  retryModelRuntimeJob:mocks.retry,
  createAssetVariant:mocks.createVariant,
  createAssetVariantState:mocks.createState,
  updateAssetVariant:mocks.updateVariant,
  updateAssetVariantState:mocks.updateState,
  deleteAssetVariant:mocks.deleteVariant,
  deleteAssetVariantState:mocks.deleteState,
  suggestAssetVariant:mocks.suggestVariant,
  mediaUrl:(path:string)=>path,
}));
vi.mock('../lib/jobs',()=>({pollJob:mocks.pollJob}));
vi.mock('../components/assets/CharacterModelPreview',()=>({CharacterModelPreview:({url}:{url:string})=><div data-testid="character-model-preview" data-url={url}/>}));

const character={id:'c1',project_id:'p1',name:'林夏',role:'主角',body_plan:'humanoid' as const,appearance_bible:'黑色风衣',personality:'冷静',continuity_rules:'银色耳钉',negative_constraints:'',voice_speaker:'v1',voice_instruction:'',created_at:'',updated_at:''};
const reference={id:'r1',character_id:'c1',reference_type:'primary' as const,label:'主参考',position:0,is_active:false,review_status:'draft' as const,created_at:'',asset:{id:'a1',kind:'character-reference',media_url:'/media/a.png',media_type:'image/png',provider:'upload',model:'local',generation_attempt:1,review_status:'draft',width:1,height:1,duration_seconds:null,created_at:''}};
const approvedReference=(type:'front'|'side'|'back'|'expression'|'outfit',index:number)=>({...reference,id:`r${index}`,reference_type:type,label:type,is_active:true,review_status:'approved' as const,asset:{...reference.asset,id:`a${index}`,media_url:`/media/${type}.png`,review_status:'approved'}});
const allReferences=[reference,approvedReference('front',2),approvedReference('side',3),approvedReference('back',4),approvedReference('expression',5),approvedReference('outfit',6)];
const variants=[
  {id:'v1',character_id:'c1',episode_id:null,parent_variant_id:null,kind:'master' as const,label:'作品主设定',inherited_fields:[],overrides:{identity:'脸型'},version:4,review_status:'approved' as const,created_at:'',updated_at:'',states:[],usages:[]},
  {id:'v2',character_id:'c1',episode_id:'e1',parent_variant_id:'v1',kind:'episode' as const,label:'第 01 集雨夜造型',inherited_fields:['identity','hair'],overrides:{outfit:'雨衣'},version:2,review_status:'draft' as const,created_at:'',updated_at:'',states:[{id:'s1',variant_id:'v2',kind:'injury' as const,label:'左臂擦伤',overrides:{injury:'left-arm'},version:1,created_at:'',updated_at:''}],usages:[]},
];
const job=(status:'queued'|'running'|'succeeded'|'failed',metadata:Record<string,unknown>={})=>({id:'job-1',operation:'runtime_image',target_type:'character',target_id:'c1',status,progress:status==='succeeded'?100:29,result_metadata:metadata,error:'',retry_count:0,created_at:'',updated_at:''});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(allReferences);
  mocks.variants.mockResolvedValue(variants);
  mocks.representations.mockResolvedValue([]);
  mocks.latestModel3D.mockResolvedValue(null);
  mocks.generateModel3D.mockResolvedValue({job_id:'job-3d',capability:'model3d',status:'queued'});
  mocks.approveModel3D.mockResolvedValue({review_status:'approved',is_active:true});
  mocks.characterImpact.mockResolvedValue({shots:[],assets:[],usage_count:0,episodes:[]});
  mocks.variantImpact.mockResolvedValue({shots:[],assets:[],usage_count:0,episodes:[]});
  mocks.stateImpact.mockResolvedValue({shots:[],assets:[],usage_count:0,episodes:[]});
  mocks.createProductionRun.mockResolvedValue({id:'run-impact'});
  mocks.libraryAssets.mockResolvedValue([]);
  mocks.createCharacter.mockResolvedValue({...character,id:'c-new',name:'周然',role:'搭档'});
  mocks.updateCharacter.mockResolvedValue({...character,name:'林夏·修订',role:'调查员'});
  mocks.deleteReference.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue({...reference,review_status:'approved'});
  mocks.activate.mockResolvedValue({...reference,review_status:'approved',is_active:true});
  mocks.generateSet.mockResolvedValue({job_id:'job-1',capability:'image',status:'queued'});
  mocks.retry.mockResolvedValue({job_id:'job-1',capability:'image',status:'queued'});
  mocks.pollJob.mockResolvedValue(job('succeeded',{mode:'reference_set',completed_types:['primary','front','three_quarter','side','back','expression','outfit']}));
  mocks.suggestVariant.mockResolvedValue({
    kind:'episode',label:'第 01 集唐代造型',summary:'保留身份特征，替换为唐代书生服装。',
    inherited_fields:['identity','face','body_proportions'],overrides:{outfit:'唐代书生服装',headwear:'书生帽'},
    state_kind:null,assistant_message:'这属于整集持续生效的造型变化，建议创建为集级变体。',
  });
});
afterEach(cleanup);

it('manages project asset catalogs even before the project has characters',async()=>{
  mocks.libraryAssets.mockResolvedValueOnce([{id:'la1',project_id:'p1',kind:'scene',name:'雨夜天台',description:'霓虹灯下的天台',tags:['雨夜'],metadata:{},created_at:'',updated_at:''}]).mockResolvedValue([]);
  mocks.createLibraryAsset.mockResolvedValue({id:'la2',project_id:'p1',kind:'scene',name:'地下车库',description:'追逐场景',tags:['室内'],metadata:{},created_at:'',updated_at:''});
  const user=userEvent.setup();
  const onMetricsChanged=vi.fn();
  render(<CharacterWorkspace projectId="p1" characters={[]} onMetricsChanged={onMetricsChanged}/>);

  await waitFor(()=>expect(mocks.libraryAssets).toHaveBeenCalledWith('p1'));
  await user.click(await screen.findByRole('button',{name:'场景 1'}));
  expect(screen.getByRole('button',{name:/雨夜天台/})).toBeVisible();

  await user.click(screen.getByRole('button',{name:'新建场景'}));
  await user.type(screen.getByRole('textbox',{name:'资产名称'}),'地下车库');
  await user.type(screen.getByRole('textbox',{name:'资产描述'}),'追逐场景');
  await user.type(screen.getByRole('textbox',{name:'资产标签'}),'室内');
  await user.click(screen.getByRole('button',{name:'保存资产'}));
  expect(mocks.createLibraryAsset).toHaveBeenCalledWith('p1',{kind:'scene',name:'地下车库',description:'追逐场景',tags:['室内'],metadata:{}});
  expect(onMetricsChanged).toHaveBeenCalledTimes(1);
});

it('creates and edits characters from the asset catalog',async()=>{
  const user=userEvent.setup();
  const onCharactersChanged=vi.fn().mockResolvedValue(undefined);
  render(<CharacterWorkspace projectId="p1" characters={[character]} onCharactersChanged={onCharactersChanged}/>);

  await user.click(await screen.findByRole('button',{name:'新建角色'}));
  const createForm=screen.getByRole('form',{name:'新建角色'});
  await user.type(within(createForm).getByRole('textbox',{name:'角色名称'}),'周然');
  await user.type(within(createForm).getByRole('textbox',{name:'角色定位'}),'搭档');
  await user.selectOptions(within(createForm).getByLabelText('实体形态'),'quadruped');
  await user.type(within(createForm).getByRole('textbox',{name:'外观设定'}),'灰色风衣');
  await user.type(within(createForm).getByRole('textbox',{name:'性格设定'}),'谨慎');
  await user.type(within(createForm).getByRole('textbox',{name:'连续性规则'}),'左手佩戴腕表');
  await user.type(within(createForm).getByRole('textbox',{name:'声音角色'}),'v2');
  await user.click(within(createForm).getByRole('button',{name:'保存角色'}));

  await waitFor(()=>expect(mocks.createCharacter).toHaveBeenCalledWith('p1',{
    name:'周然',role:'搭档',body_plan:'quadruped',appearance_bible:'灰色风衣',personality:'谨慎',continuity_rules:'左手佩戴腕表',negative_constraints:'',voice_speaker:'v2',voice_instruction:'',
  }));
  expect(await screen.findByRole('button',{name:/周然/})).toBeVisible();
  expect(onCharactersChanged).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole('button',{name:'编辑角色'}));
  const editForm=screen.getByRole('form',{name:'编辑角色'});
  const name=within(editForm).getByRole('textbox',{name:'角色名称'});
  const role=within(editForm).getByRole('textbox',{name:'角色定位'});
  await user.clear(name);
  await user.type(name,'林夏·修订');
  await user.clear(role);
  await user.type(role,'调查员');
  await user.click(within(editForm).getByRole('button',{name:'保存角色'}));

  await waitFor(()=>expect(mocks.updateCharacter).toHaveBeenCalledWith('c-new',expect.objectContaining({name:'林夏·修订',role:'调查员'})));
  expect(onCharactersChanged).toHaveBeenCalledTimes(2);
});

it('renames and deletes an inactive character reference',async()=>{
  const renamed={...reference,label:'雨夜主参考'};
  let nextReferences=allReferences;
  mocks.list.mockImplementation(()=>Promise.resolve(nextReferences));
  mocks.update.mockImplementation(async()=>{nextReferences=[renamed,...allReferences.slice(1)];return renamed;});
  mocks.deleteReference.mockImplementation(async()=>{nextReferences=allReferences.slice(1);});
  vi.spyOn(window,'confirm').mockReturnValue(true);
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]}/>);

  await user.click(await screen.findByRole('button',{name:/林夏/}));
  await user.click(screen.getByRole('button',{name:'参考集'}));
  await user.click(await screen.findByRole('button',{name:'重命名主参考'}));
  const input=screen.getByRole('textbox',{name:'参考图名称'});
  await user.clear(input);
  await user.type(input,'雨夜主参考');
  await user.click(screen.getByRole('button',{name:'保存参考图名称'}));
  await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith('r1',{label:'雨夜主参考'}));

  await user.click(await screen.findByRole('button',{name:'删除雨夜主参考'}));
  await waitFor(()=>expect(mocks.deleteReference).toHaveBeenCalledWith('r1'));
});

it('keeps the AI variant workspace inside one viewport without a canvas scrollbar',()=>{
  const css=readAllStyles();
  expect(css).toMatch(/\.variant-editor-layout\s*\{[^}]*height:\s*100%[^}]*grid-template-columns:[^;]*minmax\(0,\s*1fr\)[^}]*overflow:\s*hidden[^}]*\}/s);
  expect(css).toMatch(/\.variant-editor-main\s*\{[^}]*height:\s*100%[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto[^}]*overflow:\s*hidden[^}]*\}/s);
  expect(css).toMatch(/\.ai-variant-canvas-shell\s*\{[^}]*min-height:\s*0[^}]*height:\s*100%[^}]*\}/s);
  expect(css).toMatch(/\.ai-variant-canvas\s*>\s*img\s*\{[^}]*position:\s*absolute[^}]*inset:\s*var\(--space-2\)[^}]*width:\s*calc\(100%\s*-\s*var\(--space-4\)\)[^}]*height:\s*calc\(100%\s*-\s*var\(--space-4\)\)[^}]*object-fit:\s*contain[^}]*\}/s);
});

it('keeps the character master setting inside one viewport without panel scrollbars',()=>{
  const css=readAllStyles();
  expect(css).toMatch(/\.master-setting-page\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden[^}]*\}/s);
  expect(css).toMatch(/\.master-setting-content\s*\{[^}]*height:\s*100%[^}]*display:\s*grid[^}]*grid-template-rows:[^;]*minmax\(0,\s*1fr\)[^}]*overflow:\s*hidden[^}]*\}/s);
  expect(css).toMatch(/\.master-image-grid\s*\{[^}]*height:\s*100%[^}]*grid-template-rows:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*\}/s);
  expect(css).toMatch(/\.master-setting-page\s*>\s*\.master-setting-inspector\s*\{[^}]*overflow:\s*hidden[^}]*\}/s);
  expect(css).toMatch(/\.master-embedded-workspace\s+\.lineage-inspector\s*\{[^}]*overflow:\s*hidden[^}]*\}/s);
  expect(css).toMatch(/\.character-model-section\s*\{[^}]*grid-template-rows:\s*minmax\(112px,\s*auto\)\s+minmax\(0,\s*1fr\)\s+auto[^}]*\}/s);
});

it('keeps the full asset catalog reachable on mobile',()=>{
  const css=readAllStyles();
  expect(css).toMatch(/@media\s*\(max-width:\s*899px\)[\s\S]*?\.workspace-grid\.mobile-characters\s+\.workspace-center\s*\{[^}]*overflow-y:\s*auto[^}]*\}/);
});

it('reviews and activates a character reference',async()=>{
  mocks.list.mockResolvedValueOnce(allReferences).mockResolvedValue([{...reference,review_status:'approved'},...allReferences.slice(1)]);
  const user=userEvent.setup();
  const onMetricsChanged=vi.fn();
  render(<CharacterWorkspace characters={[character]} onMetricsChanged={onMetricsChanged}/>);
  await user.click(await screen.findByRole('button',{name:/林夏/}));
  await user.click(screen.getByRole('button',{name:'参考集'}));
  await user.click(await screen.findByRole('button',{name:/批准/}));
  await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith('r1',{review_status:'approved'}));
  await user.click(await screen.findByRole('button',{name:'设为使用'}));
  expect(mocks.activate).toHaveBeenCalledWith('c1','r1');
  expect(onMetricsChanged).toHaveBeenCalledTimes(1);
});

it('starts one complete reference set independent of the selected filter',async()=>{
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]}/>);
  await user.click(await screen.findByRole('button',{name:/林夏/}));
  await user.click(screen.getByRole('button',{name:'参考集'}));
  await screen.findByRole('button',{name:'主参考'});
  await user.click(screen.getByRole('button',{name:'侧面'}));
  await user.click(screen.getByRole('button',{name:'一键生成整套'}));
  expect(mocks.generateSet).toHaveBeenCalledWith('c1');
  await waitFor(()=>expect(mocks.pollJob).toHaveBeenCalledWith('job-1',expect.any(Object)));
});

it('shows live set progress and prevents duplicate starts',async()=>{
  const pending=deferred<ReturnType<typeof job>>();
  let onUpdate:((value:ReturnType<typeof job>)=>void)|undefined;
  mocks.pollJob.mockImplementation((_id:string,options:{onUpdate?:(value:ReturnType<typeof job>)=>void})=>{
    onUpdate=options.onUpdate;
    return pending.promise;
  });
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]}/>);
  await user.click(await screen.findByRole('button',{name:/林夏/}));
  await user.click(screen.getByRole('button',{name:'参考集'}));
  const button=await screen.findByRole('button',{name:'一键生成整套'});
  await user.click(button);
  onUpdate?.(job('running',{mode:'reference_set',current_type:'three_quarter',current_index:2,total:7,completed_types:['primary','front']}));
  expect(await screen.findByText('正在生成 3/7：四分之三')).toBeVisible();
  expect(button).toBeDisabled();
  await user.click(button);
  expect(mocks.generateSet).toHaveBeenCalledTimes(1);
});

it('shows the failed view and retries the same persisted job',async()=>{
  const failed={...job('failed',{mode:'reference_set',failed_type:'side',completed_types:['primary','front','three_quarter'],retryable:true}),error:'image provider timed out'};
  mocks.pollJob.mockResolvedValueOnce(failed).mockResolvedValueOnce(job('succeeded'));
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]}/>);
  await user.click(await screen.findByRole('button',{name:/林夏/}));
  await user.click(screen.getByRole('button',{name:'参考集'}));
  await user.click(await screen.findByRole('button',{name:'一键生成整套'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('侧面生成失败：image provider timed out');
  await user.click(screen.getByRole('button',{name:'继续未完成项'}));
  expect(mocks.retry).toHaveBeenCalledWith('job-1');
  await waitFor(()=>expect(mocks.pollJob).toHaveBeenCalledTimes(2));
});

it('opens the master setting, variant editor, and lineage from the asset catalog',async()=>{
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]} episodes={[{id:'e1',project_id:'p1',title:'雨夜危机',premise:'',target_duration_seconds:60,status:'draft',created_at:'',updated_at:''}]}/>);

  expect(await screen.findByRole('heading',{name:'作品资产库'})).toBeVisible();
  expect(screen.getAllByText('角色实体')[0]).toBeVisible();
  expect(screen.getByText('集级变体 1')).toBeVisible();

  await user.click(screen.getByRole('button',{name:/林夏/}));
  expect(screen.getByRole('heading',{name:'角色主设定'})).toBeVisible();
  expect(screen.queryByText(/资产库 \/ 角色 \//)).not.toBeInTheDocument();
  expect(screen.getByText('1. 正面视图')).toBeVisible();
  expect(screen.getByText('6. 服装细节')).toBeVisible();

  await user.click(screen.getByRole('button',{name:'变体'}));
  expect(screen.getByRole('heading',{name:'角色主设定'})).toBeVisible();
  expect(screen.getByRole('heading',{name:'角色列表'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'返回角色主设定'})).not.toBeInTheDocument();
  expect(screen.getByRole('generic',{name:'变体创作画布'})).toBeVisible();
  expect(screen.getAllByText('第 01 集雨夜造型')[0]).toBeVisible();
  expect(screen.getAllByText('左臂擦伤')[0]).toBeVisible();

  await user.click(screen.getByRole('button',{name:'使用记录'}));
  expect(screen.getByRole('heading',{name:'角色主设定'})).toBeVisible();
  expect(screen.getByRole('heading',{name:'角色列表'})).toBeVisible();
  expect(screen.getByLabelText('谱系画布工具栏')).toBeVisible();
  expect(screen.queryByRole('heading',{name:'资产谱系'})).not.toBeInTheDocument();
});

it('uploads a GLB proxy from the character master setting',async()=>{
  const representation={id:'rep-1',character_id:'c1',variant_id:null,state_id:null,asset_id:'model-1',label:'林夏代理',format:'glb',version:1,is_active:true,review_status:'approved',model_url:'/media/linxia.glb',mesh_count:1,triangle_count:1200,material_count:1,has_skeleton:false,bounds:{},created_at:'',updated_at:''};
  mocks.uploadRepresentation.mockResolvedValue(representation);
  mocks.representations.mockResolvedValueOnce([]).mockResolvedValue([representation]);
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]}/>);
  await user.click(await screen.findByRole('button',{name:/林夏/}));
  const file=new File([new Uint8Array([1,2,3])],'linxia.glb',{type:'model/gltf-binary'});

  await user.upload(screen.getByLabelText('上传角色 3D 模型'),file);

  await waitFor(()=>expect(mocks.uploadRepresentation).toHaveBeenCalledWith('c1',file));
  expect(await screen.findByText('林夏代理')).toBeVisible();
  expect(screen.getByText('1,200 三角面')).toBeVisible();
});

it('shows detected skeleton, animation clip, and morph target details for a GLB',async()=>{
  const representation={id:'rep-rigged',character_id:'c1',variant_id:null,state_id:null,asset_id:'model-rigged',label:'林夏绑定模型',format:'glb',version:2,is_active:true,review_status:'approved',model_url:'/media/linxia-rigged.glb',mesh_count:1,triangle_count:3200,material_count:2,has_skeleton:true,bounds:{},metadata:{skin_count:1,joint_count:24,skeletons:[{name:'Humanoid',root:'Root',joint_count:24,joints:['Hips','Spine']}],animation_clips:[{name:'Walk',duration_seconds:2.5,channel_count:12,target_nodes:['Hips'],target_paths:['translation']}],morph_targets:['Smile','Blink']},created_at:'',updated_at:''};
  mocks.representations.mockResolvedValue([representation]);
  render(<CharacterWorkspace characters={[character]}/>);

  await userEvent.click(await screen.findByRole('button',{name:/林夏/}));

  expect(await screen.findByText('1 套骨骼 · 24 个关节')).toBeVisible();
  expect(screen.getByText('动画片段：Walk（2.5 秒）')).toBeVisible();
  expect(screen.getByText('表情目标：Smile、Blink')).toBeVisible();
});

it('uploads a GLB for a selected episode state scope',async()=>{
  const stateRepresentation={id:'rep-state',character_id:'c1',variant_id:'v2',state_id:'s1',asset_id:'model-state',label:'左臂擦伤代理',format:'glb',version:2,is_active:true,review_status:'approved',model_url:'/media/injured.glb',mesh_count:1,triangle_count:1400,material_count:1,has_skeleton:false,bounds:{},created_at:'',updated_at:''};
  mocks.uploadRepresentation.mockResolvedValue(stateRepresentation);
  mocks.representations.mockResolvedValueOnce([]).mockResolvedValue([stateRepresentation]);
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]}/>);
  await user.click(await screen.findByRole('button',{name:/林夏/}));
  await user.selectOptions(screen.getByLabelText('3D 模型作用域'),'state:s1');
  const file=new File([new Uint8Array([1,2,3])],'injured.glb',{type:'model/gltf-binary'});

  await user.upload(screen.getByLabelText('上传角色 3D 模型'),file);

  await waitFor(()=>expect(mocks.uploadRepresentation).toHaveBeenCalledWith('c1',file,'','v2','s1'));
  expect(await screen.findByText('左臂擦伤代理')).toBeVisible();
});

it('generates a reviewable 3D candidate for the selected state scope',async()=>{
  const candidate={id:'rep-state-ai',character_id:'c1',variant_id:'v2',state_id:'s1',asset_id:'model-state-ai',label:'AI 生成 3D 候选',format:'glb',version:3,is_active:false,review_status:'draft',model_url:'/media/injured-ai.glb',mesh_count:1,triangle_count:1800,material_count:1,has_skeleton:false,bounds:{},created_at:'',updated_at:''};
  mocks.pollJob.mockResolvedValue({...job('succeeded',{capability:'model3d',representation_id:'rep-state-ai',model_url:'/media/injured-ai.glb',review_status:'draft',is_active:false}),id:'job-3d',operation:'runtime_model3d'});
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]}/>);
  await user.click(await screen.findByRole('button',{name:/林夏/}));
  await user.selectOptions(screen.getByLabelText('3D 模型作用域'),'state:s1');
  mocks.representations.mockResolvedValue([candidate]);

  await user.click(screen.getByRole('button',{name:'根据参考图生成 3D'}));

  await waitFor(()=>expect(mocks.generateModel3D).toHaveBeenCalledWith(
    'character','c1','a2','v2','s1',['a2','a3','a4'],
  ));
  expect(await screen.findByText('AI 生成 3D 候选')).toBeVisible();
});

it('generates a reviewable 3D candidate from an existing character reference',async()=>{
  const candidate={id:'rep-ai',character_id:'c1',variant_id:null,state_id:null,asset_id:'model-ai',label:'AI 生成 3D 候选',format:'glb',version:2,is_active:false,review_status:'draft',model_url:'/media/linxia-ai.glb',mesh_count:1,triangle_count:2400,material_count:1,has_skeleton:false,bounds:{},created_at:'',updated_at:''};
  mocks.pollJob.mockResolvedValue({...job('succeeded',{capability:'model3d',representation_id:'rep-ai',model_url:'/media/linxia-ai.glb',review_status:'draft',is_active:false}),id:'job-3d',operation:'runtime_model3d'});
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]}/>);
  await user.click(await screen.findByRole('button',{name:/林夏/}));
  mocks.representations.mockResolvedValue([candidate]);

  await user.click(screen.getByRole('button',{name:'根据参考图生成 3D'}));

  expect(screen.getByText('将使用 3 张已批准视图')).toBeVisible();
  await waitFor(()=>expect(mocks.generateModel3D).toHaveBeenCalledWith(
    'character','c1','a2',null,null,['a2','a3','a4'],
  ));
  expect(await screen.findByText('AI 生成 3D 候选')).toBeVisible();
  await user.click(screen.getByRole('button',{name:'批准使用 3D 候选'}));
  expect(await screen.findByRole('dialog',{name:'确认 3D 变更影响'})).toBeVisible();
  expect(mocks.characterImpact).toHaveBeenCalledWith('c1');
  expect(mocks.approveModel3D).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'仅批准'}));
  expect(mocks.approveModel3D).toHaveBeenCalledWith('job-3d');
});

it('approves a 3D candidate before regenerating its affected panels',async()=>{
  const affected={shots:['shot-1'],assets:[],usage_count:1,episodes:[{episode_id:'e1',episode_title:'第一集',scenes:[{scene_id:'sc1',scene_label:'场景 01 · 巷道',shots:[{id:'shot-1',position:1,composition:'近景'}]}]}]};
  const candidate={id:'rep-ai',character_id:'c1',variant_id:null,state_id:null,asset_id:'model-ai',label:'AI 生成 3D 候选',format:'glb',version:2,is_active:false,review_status:'draft',model_url:'/media/linxia-ai.glb',mesh_count:1,triangle_count:2400,material_count:1,has_skeleton:false,bounds:{},created_at:'',updated_at:''};
  const order:string[]=[];
  mocks.representations.mockResolvedValue([candidate]);
  mocks.latestModel3D.mockResolvedValue({...job('succeeded',{representation_id:'rep-ai',is_active:false}),id:'job-3d'});
  mocks.characterImpact.mockResolvedValue(affected);
  mocks.approveModel3D.mockImplementation(async()=>{order.push('approve');return{review_status:'approved',is_active:true};});
  mocks.createProductionRun.mockImplementation(async()=>{order.push('regenerate');return{id:'run-impact'};});
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]}/>);
  await user.click(await screen.findByRole('button',{name:/林夏/}));
  await user.click(await screen.findByRole('button',{name:'批准使用 3D 候选'}));
  await user.click(await screen.findByRole('button',{name:'批准并重生成'}));

  expect(order).toEqual(['approve','regenerate']);
  expect(await screen.findByText('3D 候选已批准，已启动 1 集的画面重生成')).toBeVisible();
});

it('starts one forced panel run per affected episode',async()=>{
  const affected={shots:['shot-1','shot-2'],assets:[],usage_count:2,episodes:[
    {episode_id:'e1',episode_title:'第一集',scenes:[{scene_id:'sc1',scene_label:'场景 01 · 巷道',shots:[{id:'shot-1',position:1,composition:'近景'}]}]},
    {episode_id:'e2',episode_title:'第二集',scenes:[{scene_id:'sc2',scene_label:'场景 01 · 天台',shots:[{id:'shot-2',position:2,composition:'远景'}]}]},
  ]};
  mocks.variantImpact.mockResolvedValue(affected);
  mocks.createProductionRun.mockResolvedValueOnce({id:'run-1'}).mockRejectedValueOnce(new Error('队列不可用'));
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]}/>);
  await user.click(await screen.findByRole('button',{name:'打开谱系'}));
  await user.click(screen.getByRole('button',{name:'分析影响范围'}));
  await user.click(await screen.findByRole('button',{name:'重新生成受影响画面'}));

  expect(mocks.createProductionRun).toHaveBeenCalledTimes(2);
  expect(mocks.createProductionRun).toHaveBeenNthCalledWith(1,'e1',{stages:['panels'],shot_ids:['shot-1'],concurrency:2,regenerate_panels:true,regenerate_speech:false,regenerate_videos:false});
  expect(mocks.createProductionRun).toHaveBeenNthCalledWith(2,'e2',{stages:['panels'],shot_ids:['shot-2'],concurrency:2,regenerate_panels:true,regenerate_speech:false,regenerate_videos:false});
  expect(await screen.findByText('已启动 1 集，1 集失败：第二集：队列不可用')).toBeVisible();
});

it('does not generate 3D from unapproved character references',async()=>{
  mocks.list.mockResolvedValue(allReferences.map(item=>({...item,review_status:'draft',is_active:false})));
  render(<CharacterWorkspace characters={[character]}/>);
  await userEvent.click(await screen.findByRole('button',{name:/林夏/}));

  expect(screen.getByRole('button',{name:'根据参考图生成 3D'})).toBeDisabled();
});

it('loads every character asset summary for catalog filters',async()=>{
  const supportingCharacter={...character,id:'c2',name:'周然',role:'搭档'};
  const masterOnly=[variants[0]];
  const supportingVariants=[
    {...variants[0],id:'v-c2-master',character_id:'c2'},
    {...variants[1],id:'v-c2-episode',character_id:'c2',parent_variant_id:'v-c2-master',episode_id:'e2',label:'第二集雨衣造型'},
  ];
  mocks.list.mockResolvedValue([]);
  mocks.variants.mockImplementation((id:string)=>Promise.resolve(id==='c2'?supportingVariants:masterOnly));
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character,supportingCharacter]}/>);

  await waitFor(()=>expect(mocks.variants).toHaveBeenCalledWith('c2'));
  await user.click(screen.getByRole('button',{name:'有变体'}));

  expect(screen.queryByRole('button',{name:/林夏/})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:/周然/})).toBeVisible();
});

it('opens catalog lineage and variant actions inside the character detail tabs',async()=>{
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]} episodes={[{id:'e1',project_id:'p1',title:'雨夜危机',premise:'',target_duration_seconds:60,status:'draft',created_at:'',updated_at:''}]}/>);

  await screen.findByRole('heading',{name:'作品资产库'});
  await user.click(screen.getByRole('button',{name:'打开谱系'}));
  expect(screen.getByRole('heading',{name:'角色主设定'})).toBeVisible();
  expect(screen.getByLabelText('谱系画布工具栏')).toBeVisible();
  expect(screen.queryByRole('button',{name:'返回角色主设定'})).not.toBeInTheDocument();
});

it('does not show a previous character image when its request resolves after switching characters',async()=>{
  const firstReferences=deferred<typeof allReferences>();
  const firstVariants=deferred<typeof variants>();
  const squidward={...character,id:'c2',name:'章鱼哥',role:'吐槽役'};
  const squidwardReference={...reference,id:'r-squid',character_id:'c2',is_active:true,asset:{...reference.asset,id:'a-squid',media_url:'/media/squidward.png'}};
  const squidwardVariants=[
    {...variants[0],id:'v-squid-master',character_id:'c2',label:'章鱼哥主设定'},
    {...variants[1],id:'v-squid-episode',character_id:'c2',parent_variant_id:'v-squid-master',label:'章鱼哥本集造型',states:[],usages:[]},
  ];
  mocks.list.mockImplementation((id:string)=>id==='c1'?firstReferences.promise:Promise.resolve([squidwardReference]));
  mocks.variants.mockImplementation((id:string)=>id==='c1'?firstVariants.promise:Promise.resolve(squidwardVariants));
  const user=userEvent.setup();
  const {container}=render(<CharacterWorkspace characters={[character,squidward]}/>);

  await user.click(screen.getByRole('button',{name:/章鱼哥/}));
  await waitFor(()=>expect(mocks.list).toHaveBeenCalledWith('c2'));
  await waitFor(()=>expect(screen.getByAltText('章鱼哥5. 全身视图')).toHaveAttribute('src','/media/squidward.png'));

  await act(async()=>{
    firstReferences.resolve(allReferences);
    firstVariants.resolve(variants);
    await Promise.resolve();
  });

  await user.click(screen.getByRole('button',{name:'使用记录'}));
  await waitFor(()=>expect(container.querySelector('.master-node img')).toHaveAttribute('src','/media/squidward.png'));
});

it('creates the missing master before the first episode variant',async()=>{
  mocks.variants.mockResolvedValue([]);
  mocks.createVariant
    .mockResolvedValueOnce({...variants[0],id:'master-new'})
    .mockResolvedValueOnce({...variants[1],id:'episode-new',parent_variant_id:'master-new'});
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]} episodes={[{id:'e1',project_id:'p1',title:'雨夜危机',premise:'',target_duration_seconds:60,status:'draft',created_at:'',updated_at:''}]}/>);

  await user.click(await screen.findByRole('button',{name:/林夏/}));
  await user.click(screen.getByRole('button',{name:'变体'}));
  expect(screen.queryByText('名称')).not.toBeInTheDocument();
  await user.type(screen.getByRole('textbox',{name:'描述角色变化'}),'第一集换成唐代书生服装，保持脸型。');
  await user.click(screen.getByRole('button',{name:'发送变体创作消息'}));

  await waitFor(()=>expect(mocks.suggestVariant).toHaveBeenCalledWith(expect.objectContaining({
    character_id:'c1',episode_id:'e1',message:'第一集换成唐代书生服装，保持脸型。',
  })));
  expect(await screen.findByText('这属于整集持续生效的造型变化，建议创建为集级变体。')).toBeVisible();
  await user.click(screen.getByRole('button',{name:'确认入库'}));

  await waitFor(()=>expect(mocks.createVariant).toHaveBeenCalledTimes(2));
  expect(mocks.createVariant).toHaveBeenNthCalledWith(1,'c1',{
    kind:'master',label:'作品主设定',episode_id:null,parent_variant_id:null,inherited_fields:[],overrides:{},
  });
  expect(mocks.createVariant).toHaveBeenNthCalledWith(2,'c1',expect.objectContaining({
    kind:'episode',label:'第 01 集唐代造型',episode_id:'e1',parent_variant_id:'master-new',
    inherited_fields:['identity','face','body_proportions'],overrides:{outfit:'唐代书生服装',headwear:'书生帽'},
  }));
});

it('stores an AI-classified injury as a state under the selected episode variant',async()=>{
  mocks.suggestVariant.mockResolvedValueOnce({
    kind:'state',label:'左臂擦伤',summary:'只在部分镜头生效的伤势。',
    inherited_fields:['identity','outfit'],overrides:{injury:'left-arm'},state_kind:'injury',
    assistant_message:'这是临时伤势，建议创建为状态。',
  });
  mocks.createState.mockResolvedValue({...variants[1].states[0]});
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]} episodes={[{id:'e1',project_id:'p1',title:'雨夜危机',premise:'',target_duration_seconds:60,status:'draft',created_at:'',updated_at:''}]}/>);

  await user.click(await screen.findByRole('button',{name:/林夏/}));
  await user.click(screen.getByRole('button',{name:'变体'}));
  await user.type(screen.getByRole('textbox',{name:'描述角色变化'}),'挨打后左臂擦伤');
  await user.click(screen.getByRole('button',{name:'发送变体创作消息'}));
  expect(await screen.findByText('这是临时伤势，建议创建为状态。')).toBeVisible();
  await user.click(screen.getByRole('button',{name:'确认入库'}));

  await waitFor(()=>expect(mocks.createState).toHaveBeenCalledWith('v2',{
    kind:'injury',label:'左臂擦伤',overrides:{injury:'left-arm'},
  }));
});
