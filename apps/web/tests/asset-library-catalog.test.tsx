import {cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {AssetCatalogView} from '../components/assets/AssetLibraryViews';
import type {AssetVariant,Character,LibraryAsset,ShotGenerationReadiness} from '../lib/types';
import type {AssetRequirement} from '../lib/shot-generation-readiness';

const character:Character={id:'c1',project_id:'p1',name:'林夏',role:'主角',appearance_bible:'',personality:'',continuity_rules:'',negative_constraints:'',voice_speaker:'',voice_instruction:'',created_at:'',updated_at:''};
const supportingCharacter:Character={...character,id:'c2',name:'周然',role:'搭档'};
const approvedMaster:AssetVariant={id:'v1',character_id:'c1',episode_id:null,parent_variant_id:null,kind:'master',label:'作品主设定',inherited_fields:[],overrides:{},version:1,review_status:'approved',created_at:'',updated_at:'',states:[],usages:[]};
const pendingEpisodeVariant:AssetVariant={...approvedMaster,id:'v2',character_id:'c2',episode_id:'e2',parent_variant_id:null,kind:'episode',label:'第二集雨衣造型',review_status:'draft'};
const assets:LibraryAsset[]=[
  {id:'la1',project_id:'p1',kind:'scene',name:'雨夜天台',description:'霓虹灯下的天台',tags:['雨夜'],metadata:{},created_at:'',updated_at:''},
  {id:'la2',project_id:'p1',kind:'scene',name:'地下车库',description:'追逐场景',tags:['室内'],metadata:{},created_at:'',updated_at:''},
  {id:'la3',project_id:'p1',kind:'prop',name:'银色怀表',description:'关键线索',tags:['线索'],metadata:{},created_at:'',updated_at:''},
  {id:'la4',project_id:'p1',kind:'costume',name:'黑色风衣',description:'主角常服',tags:['主角'],metadata:{},created_at:'',updated_at:''},
  {id:'la5',project_id:'p1',kind:'sound',name:'城市雨声',description:'环境音',tags:['环境'],metadata:{},created_at:'',updated_at:''},
];
const sceneRequirement:AssetRequirement={id:'req-scene',project_id:'p1',script_revision_id:'rev-1',kind:'scene',canonical_key:'scene:scene-1',name:'雨夜天台',description:'霓虹灯下的天台',required:true,status:'pending',binding_type:'library_asset',binding_id:'la1',source_context:{scene_ids:['scene-1'],shot_ids:['shot-1']},metadata:{time_of_day:'night'},created_at:'',updated_at:''};
const propRequirement:AssetRequirement={...sceneRequirement,id:'req-prop',kind:'prop',canonical_key:'prop:scene-1:铜制钥匙',name:'铜制钥匙',description:'打开主控室',status:'missing',binding_type:'',binding_id:null};

afterEach(cleanup);

it('filters characters using catalog data from every character',async()=>{
  const user=userEvent.setup();
  render(<AssetCatalogView
    characters={[character,supportingCharacter]}
    character={character}
    references={[]}
    variants={[approvedMaster]}
    characterAssets={{
      c1:{references:[],variants:[approvedMaster]},
      c2:{references:[],variants:[pendingEpisodeVariant]},
    }}
    libraryAssets={assets}
    onSelect={vi.fn()}
    onOpen={vi.fn()}
  />);

  await user.click(screen.getByRole('button',{name:'有变体'}));
  expect(screen.queryByRole('button',{name:/林夏/})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:/周然/})).toBeVisible();

  await user.click(screen.getByRole('button',{name:'待审核'}));
  expect(screen.queryByRole('button',{name:/林夏/})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:/周然/})).toBeVisible();

  await user.type(screen.getByRole('searchbox',{name:'搜索资产'}),'林夏');
  expect(screen.queryByRole('button',{name:/周然/})).not.toBeInTheDocument();
});

it('opens real asset categories, reports counts, and searches their records',async()=>{
  const user=userEvent.setup();
  render(<AssetCatalogView characters={[character]} character={character} references={[]} variants={[]} libraryAssets={assets} onSelect={vi.fn()} onOpen={vi.fn()} onCreateLibraryAsset={vi.fn()} onUpdateLibraryAsset={vi.fn()} onDeleteLibraryAsset={vi.fn()}/>);

  expect(screen.getByRole('button',{name:'场景 2'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'道具 1'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'服装 1'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'声音 1'})).toBeEnabled();

  await user.click(screen.getByRole('button',{name:'场景 2'}));
  expect(screen.getByRole('heading',{name:'场景资产'})).toBeVisible();
  expect(screen.getByRole('button',{name:/雨夜天台/})).toBeVisible();
  expect(screen.getByRole('button',{name:/地下车库/})).toBeVisible();
  await user.type(screen.getByRole('searchbox',{name:'搜索资产'}),'雨夜');
  expect(screen.getByRole('button',{name:/雨夜天台/})).toBeVisible();
  expect(screen.queryByRole('button',{name:/地下车库/})).not.toBeInTheDocument();

  await user.clear(screen.getByRole('searchbox',{name:'搜索资产'}));
  await user.type(screen.getByRole('searchbox',{name:'搜索资产'}),'地下');
  expect(screen.getByRole('heading',{name:'地下车库'})).toBeVisible();
});

it('creates, edits, and deletes a project library asset',async()=>{
  const user=userEvent.setup();
  const onCreate=vi.fn().mockResolvedValue(undefined);
  const onUpdate=vi.fn().mockResolvedValue(undefined);
  const onDelete=vi.fn().mockResolvedValue(undefined);
  vi.spyOn(window,'confirm').mockReturnValue(true);
  render(<AssetCatalogView characters={[character]} character={character} references={[]} variants={[]} libraryAssets={assets} onSelect={vi.fn()} onOpen={vi.fn()} onCreateLibraryAsset={onCreate} onUpdateLibraryAsset={onUpdate} onDeleteLibraryAsset={onDelete}/>);

  await user.click(screen.getByRole('button',{name:'道具 1'}));
  await user.click(screen.getByRole('button',{name:'新建道具'}));
  const form=screen.getByRole('form',{name:'新建道具资产'});
  await user.type(within(form).getByRole('textbox',{name:'资产名称'}),'铜制钥匙');
  await user.type(within(form).getByRole('textbox',{name:'资产描述'}),'打开主控室');
  await user.type(within(form).getByRole('textbox',{name:'资产标签'}),'线索, 金属');
  await user.click(within(form).getByRole('button',{name:'保存资产'}));
  expect(onCreate).toHaveBeenCalledWith({kind:'prop',name:'铜制钥匙',description:'打开主控室',tags:['线索','金属'],metadata:{}});

  await user.click(screen.getByRole('button',{name:/银色怀表/}));
  await user.click(screen.getByRole('button',{name:'编辑资产'}));
  const editForm=screen.getByRole('form',{name:'编辑道具资产'});
  const name=within(editForm).getByRole('textbox',{name:'资产名称'});
  await user.clear(name);
  await user.type(name,'损坏的银色怀表');
  await user.click(within(editForm).getByRole('button',{name:'保存资产'}));
  expect(onUpdate).toHaveBeenCalledWith('la3',expect.objectContaining({name:'损坏的银色怀表'}));

  await user.click(screen.getByRole('button',{name:'删除资产'}));
  expect(onDelete).toHaveBeenCalledWith('la3');
});

it('binds an existing asset to the selected shot requirement',async()=>{
  const onBind=vi.fn().mockResolvedValue(undefined);
  render(<AssetCatalogView characters={[]} character={null} references={[]} variants={[]} requestedCategory="scene" libraryAssets={assets} requirements={[sceneRequirement]} onSelect={vi.fn()} onOpen={vi.fn()} onBindLibraryAsset={onBind}/>);

  expect(screen.getByRole('status')).toHaveTextContent('当前镜头需要：雨夜天台');
  await userEvent.click(screen.getByRole('button',{name:'绑定到当前场景'}));

  expect(onBind).toHaveBeenCalledWith('la1','req-scene');
});

it('prefills and binds a newly created asset from the selected requirement',async()=>{
  const created={...assets[2],id:'la-new',name:'铜制钥匙',description:'打开主控室'};
  const onCreate=vi.fn().mockResolvedValue(created);
  const onBind=vi.fn().mockResolvedValue(undefined);
  render(<AssetCatalogView characters={[]} character={null} references={[]} variants={[]} requestedCategory="prop" libraryAssets={assets} requirements={[propRequirement]} onSelect={vi.fn()} onOpen={vi.fn()} onCreateLibraryAsset={onCreate} onBindLibraryAsset={onBind}/>);

  await userEvent.click(screen.getByRole('button',{name:'按需求新建道具'}));
  expect(screen.getByRole('textbox',{name:'资产名称'})).toHaveValue('铜制钥匙');
  expect(screen.getByRole('textbox',{name:'资产描述'})).toHaveValue('打开主控室');
  await userEvent.click(screen.getByRole('button',{name:'保存资产'}));

  expect(onBind).toHaveBeenCalledWith('la-new','req-prop');
});

it('returns to the shot after its assets become ready',async()=>{
  const onReturn=vi.fn();
  const readiness:ShotGenerationReadiness={shot_id:'shot-1',project_id:'p1',script_revision_id:'rev-1',ready:false,asset_ready:true,blocking_ready:false,camera_ready:false,blockers:['blocking_not_initialized','director_preview_missing'],requirement_ids:['req-scene']};
  render(<AssetCatalogView characters={[]} character={null} references={[]} variants={[]} requestedCategory="scene" libraryAssets={assets} requirements={[{...sceneRequirement,status:'ready'}]} generationReadiness={readiness} onReturnToShot={onReturn} onSelect={vi.fn()} onOpen={vi.fn()}/>);

  expect(screen.getByRole('status')).toHaveTextContent('资产已就绪，可返回镜头继续完善构图和提示词');
  await userEvent.click(screen.getByRole('button',{name:'返回原镜头'}));
  expect(onReturn).toHaveBeenCalledTimes(1);
});

it('returns to generation when every shot condition is ready',async()=>{
  const onReturn=vi.fn();
  const readiness:ShotGenerationReadiness={shot_id:'shot-1',project_id:'p1',script_revision_id:'rev-1',ready:true,asset_ready:true,blocking_ready:true,camera_ready:true,blockers:[],requirement_ids:['req-scene']};
  render(<AssetCatalogView characters={[]} character={null} references={[]} variants={[]} requestedCategory="scene" libraryAssets={assets} requirements={[{...sceneRequirement,status:'ready'}]} generationReadiness={readiness} onReturnToShot={onReturn} onSelect={vi.fn()} onOpen={vi.fn()}/>);

  expect(screen.getByRole('status')).toHaveTextContent('镜头生成条件已完成');
  await userEvent.click(screen.getByRole('button',{name:'返回原镜头继续生成'}));
  expect(onReturn).toHaveBeenCalledTimes(1);
});

it('keeps the originating-shot action visible for a character requirement',async()=>{
  const onReturn=vi.fn();
  const characterRequirement:AssetRequirement={...sceneRequirement,id:'req-character',kind:'character',canonical_key:'character:c1',name:'林夏',description:'主角身份参考',status:'missing',binding_type:'character',binding_id:'c1'};
  render(<AssetCatalogView characters={[character]} character={character} references={[]} variants={[]} requestedCategory="character" requirements={[characterRequirement]} onReturnToShot={onReturn} onSelect={vi.fn()} onOpen={vi.fn()}/>);

  expect(screen.getByRole('status')).toHaveTextContent('当前镜头需要：林夏');
  await userEvent.click(screen.getByRole('button',{name:'返回原镜头'}));
  expect(onReturn).toHaveBeenCalledTimes(1);
});

it('uploads kind-specific media for a library asset',async()=>{
  const user=userEvent.setup();
  const onUpload=vi.fn().mockResolvedValue(undefined);
  render(<AssetCatalogView characters={[character]} character={character} references={[]} variants={[]} libraryAssets={assets} onSelect={vi.fn()} onOpen={vi.fn()} onUploadLibraryAssetMedia={onUpload}/>);

  await user.click(screen.getByRole('button',{name:'服装 1'}));
  const file=new File(['png'],'coat.png',{type:'image/png'});
  await user.upload(screen.getByLabelText('上传服装媒体'),file);

  expect(onUpload).toHaveBeenCalledWith('la4',file);

  await user.click(screen.getByRole('button',{name:'道具 1'}));
  expect(screen.getByLabelText('上传道具媒体')).toHaveAttribute('accept','image/png,image/jpeg,image/webp');
});

it('shows scene thumbnails and generates a scene reference image with AI',async()=>{
  const user=userEvent.setup();
  const onGenerate=vi.fn().mockResolvedValue(undefined);
  const sceneAssets=assets.map(item=>item.id==='la1'?{...item,media_asset_id:'scene-media-1',media_url:'/media/rooftop.png',media_type:'image/png'}:item);
  render(<AssetCatalogView characters={[character]} character={character} references={[]} variants={[]} libraryAssets={sceneAssets} onSelect={vi.fn()} onOpen={vi.fn()} onGenerateLibraryAssetImage={onGenerate}/>);

  await user.click(screen.getByRole('button',{name:'场景 2'}));
  expect(screen.getByRole('img',{name:'雨夜天台缩略图'})).toHaveAttribute('src','/media/rooftop.png');
  await user.click(screen.getByRole('button',{name:'AI 生成场景参考图'}));
  expect(onGenerate).toHaveBeenCalledWith('la1');
});
