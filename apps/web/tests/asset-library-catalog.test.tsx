import {cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {AssetCatalogView} from '../components/assets/AssetLibraryViews';
import type {Character,LibraryAsset} from '../lib/types';

const character:Character={id:'c1',project_id:'p1',name:'林夏',role:'主角',appearance_bible:'',personality:'',continuity_rules:'',negative_constraints:'',voice_speaker:'',voice_instruction:'',created_at:'',updated_at:''};
const assets:LibraryAsset[]=[
  {id:'la1',project_id:'p1',kind:'scene',name:'雨夜天台',description:'霓虹灯下的天台',tags:['雨夜'],metadata:{},created_at:'',updated_at:''},
  {id:'la2',project_id:'p1',kind:'scene',name:'地下车库',description:'追逐场景',tags:['室内'],metadata:{},created_at:'',updated_at:''},
  {id:'la3',project_id:'p1',kind:'prop',name:'银色怀表',description:'关键线索',tags:['线索'],metadata:{},created_at:'',updated_at:''},
  {id:'la4',project_id:'p1',kind:'costume',name:'黑色风衣',description:'主角常服',tags:['主角'],metadata:{},created_at:'',updated_at:''},
  {id:'la5',project_id:'p1',kind:'sound',name:'城市雨声',description:'环境音',tags:['环境'],metadata:{},created_at:'',updated_at:''},
];

afterEach(cleanup);

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

it('uploads kind-specific media for a library asset',async()=>{
  const user=userEvent.setup();
  const onUpload=vi.fn().mockResolvedValue(undefined);
  render(<AssetCatalogView characters={[character]} character={character} references={[]} variants={[]} libraryAssets={assets} onSelect={vi.fn()} onOpen={vi.fn()} onUploadLibraryAssetMedia={onUpload}/>);

  await user.click(screen.getByRole('button',{name:'服装 1'}));
  const file=new File(['png'],'coat.png',{type:'image/png'});
  await user.upload(screen.getByLabelText('上传服装媒体'),file);

  expect(onUpload).toHaveBeenCalledWith('la4',file);
});
