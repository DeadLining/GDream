import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';

afterEach(cleanup);

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({nodes, nodeTypes, defaultViewport, fitView, children}: any) => (
    <div data-testid="react-flow" data-default-zoom={defaultViewport?.zoom} data-fit-view={String(Boolean(fitView))}>
      {nodes.map((node: any) => {
        const Node = nodeTypes[node.type];
        return Node ? <Node key={node.id} id={node.id} data={node.data} /> : null;
      })}
      {children}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: {Left: 'left', Right: 'right'},
  applyNodeChanges: (_: any, nodes: any) => nodes,
}));

import {AssetLineageCanvas} from '../components/canvas/AssetLineageCanvas';

const character = {id:'c1',project_id:'p1',name:'林夏',role:'主角',appearance_bible:'黑色短发，银色耳钉',personality:'冷静',continuity_rules:'保持脸型与耳钉',negative_constraints:'',voice_speaker:'v1',voice_instruction:'',created_at:'',updated_at:''};
const reference = {id:'r1',character_id:'c1',reference_type:'primary' as const,label:'主参考',position:0,is_active:true,review_status:'approved' as const,created_at:'',asset:{id:'a1',kind:'character-reference',media_url:'/media/a.png',media_type:'image/png',provider:'upload',model:'local',generation_attempt:1,review_status:'approved',width:1024,height:1536,duration_seconds:null,created_at:''}};
const variants=[{id:'v1',character_id:'c1',episode_id:null,parent_variant_id:null,kind:'master' as const,label:'作品主设定',inherited_fields:[],overrides:{identity:'脸型'},version:1,review_status:'approved' as const,created_at:'',updated_at:'',states:[],usages:[]},{id:'v2',character_id:'c1',episode_id:'e3',parent_variant_id:'v1',kind:'episode' as const,label:'受伤造型',inherited_fields:['identity','hair'],overrides:{injury:'左眉伤痕',outfit:'破损外套'},version:2,review_status:'draft' as const,created_at:'',updated_at:'',states:[{id:'st1',variant_id:'v2',kind:'expression' as const,label:'警惕',overrides:{eyes:'收紧'},version:1,created_at:'',updated_at:''}],usages:[{id:'u1',variant_id:'v2',state_id:'st1',shot_id:'shot-5',asset_id:null,usage_kind:'panel' as const,created_at:''}]},{id:'v3',character_id:'c1',episode_id:'e3',parent_variant_id:'v1',kind:'episode' as const,label:'雨夜造型',inherited_fields:['identity'],overrides:{outfit:'雨衣'},version:1,review_status:'draft' as const,created_at:'',updated_at:'',states:[{id:'st2',variant_id:'v3',kind:'outfit' as const,label:'摘下雨帽',overrides:{hood:false},version:1,created_at:'',updated_at:''}],usages:[]}];

describe('AssetLineageCanvas', () => {
  afterEach(cleanup);

  it('shows the selected character master image before any variants exist', () => {
    const {container}=render(<AssetLineageCanvas character={character} references={[reference]} variants={[]}/>);

    expect(screen.getByRole('button',{name:'林夏 作品主设定'})).toBeVisible();
    expect(container.querySelector('.master-node img')).toHaveAttribute('src','/media/a.png');
  });

  it('selects an episode variant and explains inheritance and impact', async () => {
    render(<AssetLineageCanvas character={character} references={[reference]} variants={variants}/>);

    expect(screen.getByRole('button', {name: '林夏 作品主设定'})).toBeVisible();
    await userEvent.click(screen.getByRole('button', {name: '受伤造型'}));

    expect(screen.getByRole('heading', {name: '受伤造型'})).toBeVisible();
    expect(screen.getByText('继承：identity、hair')).toBeVisible();
    expect(screen.getByText('覆盖：injury、outfit')).toBeVisible();
    expect(screen.getByText('1 个镜头引用')).toBeVisible();
    expect(screen.getByRole('button',{name:'警惕'})).toBeVisible();
  });

  it('creates an episode variant and a state from the lineage inspector', async () => {
    const onCreateVariant=vi.fn().mockResolvedValue(undefined);
    const onCreateState=vi.fn().mockResolvedValue(undefined);
    render(<AssetLineageCanvas character={character} references={[reference]} variants={variants} onCreateVariant={onCreateVariant} onCreateState={onCreateState}/>);

    await userEvent.click(screen.getByRole('button',{name:'林夏 作品主设定'}));
    await userEvent.click(screen.getByRole('button',{name:'创建子变体'}));
    await userEvent.type(screen.getByRole('textbox',{name:'变体名称'}),'第 03 集雨夜造型');
    await userEvent.click(screen.getByRole('button',{name:'保存变体'}));
    expect(onCreateVariant).toHaveBeenCalledWith(expect.objectContaining({kind:'episode',label:'第 03 集雨夜造型',parent_variant_id:'v1'}));

    await userEvent.click(screen.getByRole('button',{name:'受伤造型'}));
    await userEvent.click(screen.getByRole('button',{name:'创建状态'}));
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'状态类型'}),'injury');
    await userEvent.type(screen.getByRole('textbox',{name:'状态名称'}),'左臂擦伤');
    await userEvent.click(screen.getByRole('button',{name:'保存状态'}));
    expect(onCreateState).toHaveBeenCalledWith('v2',expect.objectContaining({kind:'injury',label:'左臂擦伤'}));
  });

  it('edits and deletes unreferenced variants and states', async () => {
    const onUpdateVariant=vi.fn().mockResolvedValue(undefined);
    const onDeleteVariant=vi.fn().mockResolvedValue(undefined);
    const onUpdateState=vi.fn().mockResolvedValue(undefined);
    const onDeleteState=vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window,'confirm').mockReturnValue(true);
    render(<AssetLineageCanvas character={character} references={[reference]} variants={variants} onUpdateVariant={onUpdateVariant} onDeleteVariant={onDeleteVariant} onUpdateState={onUpdateState} onDeleteState={onDeleteState}/>);

    await userEvent.click(screen.getByRole('button',{name:'雨夜造型'}));
    await userEvent.click(screen.getByRole('button',{name:'编辑变体'}));
    const variantName=screen.getByRole('textbox',{name:'变体名称'});
    await userEvent.clear(variantName);
    await userEvent.type(variantName,'雨夜潜行造型');
    await userEvent.click(screen.getByRole('button',{name:'保存变体'}));
    expect(onUpdateVariant).toHaveBeenCalledWith('v3',expect.objectContaining({label:'雨夜潜行造型'}));

    await userEvent.click(screen.getByRole('button',{name:'摘下雨帽'}));
    await userEvent.click(screen.getByRole('button',{name:'编辑状态'}));
    const stateName=screen.getByRole('textbox',{name:'状态名称'});
    await userEvent.clear(stateName);
    await userEvent.type(stateName,'雨帽放下');
    await userEvent.click(screen.getByRole('button',{name:'保存状态'}));
    expect(onUpdateState).toHaveBeenCalledWith('st2',expect.objectContaining({label:'雨帽放下',kind:'outfit'}));

    await userEvent.click(screen.getByRole('button',{name:'删除状态'}));
    expect(onDeleteState).toHaveBeenCalledWith('st2');

    await userEvent.click(screen.getByRole('button',{name:'雨夜造型'}));
    await userEvent.click(screen.getByRole('button',{name:'删除变体'}));
    expect(onDeleteVariant).toHaveBeenCalledWith('v3');
  });

  it('binds a selected state to a shot for downstream panel generation', async () => {
    const onLoadEpisodeShots=vi.fn().mockResolvedValue([
      {id:'shot-7',label:'镜头 07 · 左眉伤痕特写'},
    ]);
    const onCreateUsage=vi.fn().mockResolvedValue(undefined);
    render(<AssetLineageCanvas character={character} references={[reference]} variants={variants} episodes={[{id:'e3',project_id:'p1',title:'第三集',premise:'',target_duration_seconds:60,status:'planned',created_at:'',updated_at:''}]} onLoadEpisodeShots={onLoadEpisodeShots} onCreateUsage={onCreateUsage}/>);

    await userEvent.click(screen.getByRole('button',{name:'警惕'}));
    await userEvent.click(screen.getByRole('button',{name:'绑定到镜头'}));
    expect(onLoadEpisodeShots).toHaveBeenCalledWith('e3');
    await userEvent.selectOptions(await screen.findByRole('combobox',{name:'目标镜头'}),'shot-7');
    await userEvent.click(screen.getByRole('button',{name:'保存镜头绑定'}));

    expect(onCreateUsage).toHaveBeenCalledWith('v2',{
      state_id:'st1',shot_id:'shot-7',usage_kind:'panel',
    });
  });
});
