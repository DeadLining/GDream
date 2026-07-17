import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AssetVariantEditorView} from '../components/assets/AssetLibraryViews';
import type {AssetVariant,Character,EpisodeSummary} from '../lib/types';

const mocks=vi.hoisted(()=>({suggestAssetVariant:vi.fn()}));
vi.mock('../lib/api',()=>({mediaUrl:(value:string)=>value,suggestAssetVariant:mocks.suggestAssetVariant}));

const character:Character={id:'character-1',project_id:'project-1',name:'林默',role:'主角',appearance_bible:'黑发',personality:'冷静',continuity_rules:'保持脸型',negative_constraints:'',voice_speaker:'',voice_instruction:'',created_at:'',updated_at:''};
const episodes:EpisodeSummary[]=[
  {id:'episode-1',project_id:'project-1',title:'第一集',premise:'出发',target_duration_seconds:60,status:'planned',created_at:'',updated_at:''},
  {id:'episode-2',project_id:'project-1',title:'第二集',premise:'受伤',target_duration_seconds:60,status:'planned',created_at:'',updated_at:''},
];
const variants:AssetVariant[]=[{id:'master-1',character_id:'character-1',episode_id:null,parent_variant_id:null,kind:'master',label:'作品主设定',inherited_fields:[],overrides:{},version:1,review_status:'approved',created_at:'',updated_at:'',states:[],usages:[]}];

describe('AssetVariantEditorView',()=>{
  afterEach(()=>{cleanup();vi.clearAllMocks();});

  it('creates an AI episode variant for the explicitly selected episode',async()=>{
    mocks.suggestAssetVariant.mockResolvedValue({kind:'episode',label:'受伤造型',summary:'第二集受伤',inherited_fields:['identity'],overrides:{injury:'左眉伤痕'},state_kind:null,assistant_message:'已生成第二集变体'});
    const onCreateVariant=vi.fn().mockResolvedValue(undefined);
    render(<AssetVariantEditorView embedded character={character} references={[]} variants={variants} episodes={episodes} onOpen={vi.fn()} onCreateVariant={onCreateVariant} onCreateState={vi.fn()}/>);

    await userEvent.selectOptions(screen.getByRole('combobox',{name:'目标剧集'}),'episode-2');
    await userEvent.type(screen.getByRole('textbox',{name:'描述角色变化'}),'第二集左眉受伤');
    await userEvent.click(screen.getByRole('button',{name:'发送变体创作消息'}));
    await userEvent.click(await screen.findByRole('button',{name:'确认入库'}));

    await waitFor(()=>expect(onCreateVariant).toHaveBeenCalledWith(expect.objectContaining({kind:'episode',episode_id:'episode-2',label:'受伤造型'})));
    expect(mocks.suggestAssetVariant).toHaveBeenCalledWith(expect.objectContaining({episode_id:'episode-2'}));
  });

  it('opens the exact variant state selected by global search',()=>{
    const searchableVariants:AssetVariant[]=[
      ...variants,
      {id:'variant-1',character_id:'character-1',episode_id:'episode-1',parent_variant_id:'master-1',kind:'episode',label:'雨夜造型',inherited_fields:[],overrides:{},version:1,review_status:'approved',created_at:'',updated_at:'',states:[{id:'state-1',variant_id:'variant-1',kind:'outfit',label:'黑色风衣',overrides:{},created_at:'',updated_at:'',usages:[]}],usages:[]},
      {id:'variant-2',character_id:'character-1',episode_id:'episode-2',parent_variant_id:'master-1',kind:'episode',label:'受伤造型',inherited_fields:[],overrides:{},version:1,review_status:'draft',created_at:'',updated_at:'',states:[{id:'state-2',variant_id:'variant-2',kind:'injury',label:'左眉伤痕',overrides:{},created_at:'',updated_at:'',usages:[]}],usages:[]},
    ];
    render(<AssetVariantEditorView embedded character={character} references={[]} variants={searchableVariants} episodes={episodes} initialVariantId="variant-2" initialStateId="state-2" onOpen={vi.fn()} onCreateVariant={vi.fn()} onCreateState={vi.fn()}/>);

    expect(screen.getByRole('button',{name:/左眉伤痕/})).toHaveClass('active');
    expect(screen.getByText('当前基线').parentElement).toHaveTextContent('受伤造型');
  });
});
