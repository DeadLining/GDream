import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CharacterWorkspace} from '../components/CharacterWorkspace';
import {readAllStyles} from './_styles';

const mocks=vi.hoisted(()=>({
  list:vi.fn(),upload:vi.fn(),generateSet:vi.fn(),update:vi.fn(),activate:vi.fn(),
  retry:vi.fn(),pollJob:vi.fn(),variants:vi.fn(),
  libraryAssets:vi.fn(),createLibraryAsset:vi.fn(),updateLibraryAsset:vi.fn(),deleteLibraryAsset:vi.fn(),
  suggestVariant:vi.fn(),
  createVariant:vi.fn(),createState:vi.fn(),updateVariant:vi.fn(),updateState:vi.fn(),deleteVariant:vi.fn(),deleteState:vi.fn(),
}));
vi.mock('../lib/api',()=>({
  listCharacterReferences:mocks.list,
  listAssetVariants:mocks.variants,
  listLibraryAssets:mocks.libraryAssets,
  createLibraryAsset:mocks.createLibraryAsset,
  updateLibraryAsset:mocks.updateLibraryAsset,
  deleteLibraryAsset:mocks.deleteLibraryAsset,
  uploadCharacterReference:mocks.upload,
  generateCharacterReferenceSet:mocks.generateSet,
  updateCharacterReference:mocks.update,
  activateCharacterReference:mocks.activate,
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

const character={id:'c1',project_id:'p1',name:'林夏',role:'主角',appearance_bible:'黑色风衣',personality:'冷静',continuity_rules:'银色耳钉',negative_constraints:'',voice_speaker:'v1',voice_instruction:'',created_at:'',updated_at:''};
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
  mocks.libraryAssets.mockResolvedValue([]);
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
  render(<CharacterWorkspace projectId="p1" characters={[]}/>);

  await waitFor(()=>expect(mocks.libraryAssets).toHaveBeenCalledWith('p1'));
  await user.click(await screen.findByRole('button',{name:'场景 1'}));
  expect(screen.getByRole('button',{name:/雨夜天台/})).toBeVisible();

  await user.click(screen.getByRole('button',{name:'新建场景'}));
  await user.type(screen.getByRole('textbox',{name:'资产名称'}),'地下车库');
  await user.type(screen.getByRole('textbox',{name:'资产描述'}),'追逐场景');
  await user.type(screen.getByRole('textbox',{name:'资产标签'}),'室内');
  await user.click(screen.getByRole('button',{name:'保存资产'}));
  expect(mocks.createLibraryAsset).toHaveBeenCalledWith('p1',{kind:'scene',name:'地下车库',description:'追逐场景',tags:['室内'],metadata:{}});
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
});

it('reviews and activates a character reference',async()=>{
  mocks.list.mockResolvedValueOnce(allReferences).mockResolvedValue([{...reference,review_status:'approved'},...allReferences.slice(1)]);
  const user=userEvent.setup();
  render(<CharacterWorkspace characters={[character]}/>);
  await user.click(await screen.findByRole('button',{name:/林夏/}));
  await user.click(screen.getByRole('button',{name:'参考集'}));
  await user.click(await screen.findByRole('button',{name:/批准/}));
  await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith('r1',{review_status:'approved'}));
  await user.click(await screen.findByRole('button',{name:'设为使用'}));
  expect(mocks.activate).toHaveBeenCalledWith('c1','r1');
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
  expect(screen.getByText('角色资产')).toBeVisible();
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
