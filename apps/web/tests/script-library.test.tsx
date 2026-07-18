import {cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {ScriptLibrary} from '../components/ScriptLibrary';
import type {ScriptDocument, ScriptDocumentSummary} from '../lib/types';
import {readAllStyles} from './_styles';

const mocks=vi.hoisted(()=>({
  list:vi.fn(),get:vi.fn(),project:vi.fn(),create:vi.fn(),patch:vi.fn(),finalize:vi.fn(),stream:vi.fn(),remove:vi.fn(),removeRevision:vi.fn(),upload:vi.fn(),revisions:vi.fn(),restore:vi.fn(),volumes:vi.fn(),storylines:vi.fn(),parse:vi.fn(),updateImport:vi.fn(),confirmImport:vi.fn(),
}));

vi.mock('../lib/api',async importOriginal=>({
  ...await importOriginal<typeof import('../lib/api')>(),
  listScripts:mocks.list,getScript:mocks.get,createScript:mocks.create,
  patchScript:mocks.patch,deleteScript:mocks.remove,uploadScript:mocks.upload,
  finalizeScript:mocks.finalize,streamDocumentScript:mocks.stream,
  listScriptRevisions:mocks.revisions,restoreScriptRevision:mocks.restore,deleteScriptRevision:mocks.removeRevision,
  listVolumes:mocks.volumes,listStorylines:mocks.storylines,getProject:mocks.project,
  parseScript:mocks.parse,updateScriptImportDraft:mocks.updateImport,confirmScriptImport:mocks.confirmImport,
}));

const revision=(content='第一集',checksum='old')=>({id:'r1',document_id:'s1',revision_number:1,status:'working' as const,content,checksum,creation_method:'paste',original_filename:'',source_file_path:'',source_media_type:'',generation_brief:'',generation_metadata:{},created_at:'2026-07-12T00:00:00Z'});
const document:ScriptDocument={id:'s1',project_id:'p1',title:'雨夜',source_type:'paste',status:'draft',revision_count:1,current_revision_id:'r1',created_at:'2026-07-12T00:00:00Z',updated_at:'2026-07-12T01:00:00Z',current_revision:revision(),latest_import_id:null,parse_is_stale:false};
const summary:ScriptDocumentSummary={...document};
const workspaceStyles=readAllStyles();

beforeEach(()=>{
  mocks.list.mockResolvedValue([summary]);mocks.get.mockResolvedValue(document);
  mocks.project.mockResolvedValue({id:'p1',title:'项目',logline:'',story_bible:'',visual_style:'漫画',aspect_ratio:'9:16',language:'zh-CN',characters:[],episodes:[{id:'e1',project_id:'p1',volume_id:'v1',position:1,title:'第一集',premise:'',target_duration_seconds:60,status:'planned',created_at:'',updated_at:''}],created_at:'',updated_at:''});
  mocks.create.mockResolvedValue(document);mocks.patch.mockImplementation(async(_id,data)=>({...document,title:data.title??document.title,current_revision:{...document.current_revision,content:data.content??document.current_revision.content,checksum:'new'}}));mocks.remove.mockResolvedValue(undefined);
  mocks.removeRevision.mockResolvedValue(undefined);
  mocks.finalize.mockResolvedValue({...document,status:'ready',current_revision:{...revision(),status:'finalized'}});
  mocks.stream.mockImplementation(async(_id,_data,handlers)=>{handlers.onChunk({text:'AI 新版本',revision_id:'r2',persisted_length:6});handlers.onDone({revision_id:'r2'});});
  mocks.upload.mockResolvedValue({...document,title:'story',source_type:'upload',revision_count:2,current_revision_id:'r2',current_revision:{...revision('第二版','new'),id:'r2',revision_number:2,status:'finalized',creation_method:'upload'}});mocks.revisions.mockResolvedValue([document.current_revision]);mocks.restore.mockResolvedValue({...document,current_revision_id:'r2',current_revision:{...revision(),id:'r2',revision_number:2,status:'finalized'}});
  mocks.volumes.mockResolvedValue([{id:'v1',project_id:'p1',position:1,title:'海底异变',summary:'',created_at:'',updated_at:'',episodes:[{id:'e1',project_id:'p1',volume_id:'v1',position:1,title:'第一集',premise:'',target_duration_seconds:60,status:'planned',created_at:'',updated_at:''}]}]);
  mocks.storylines.mockResolvedValue([{id:'l1',project_id:'p1',title:'真实时间裂缝',kind:'foreshadowing',color:'#B9473E',description:'',created_at:'',updated_at:'',events:[{id:'ev1',storyline_id:'l1',episode_id:'e1',scene_id:null,shot_id:null,position:1,stage:'setup',title:'海螺发光',description:'',setup_event_id:null,payoff_event_id:null,metadata:{},created_at:'',updated_at:''}]}]);
  const structured={project:{title:'雨夜',logline:'追查芯片'},characters:[{entity_kind:'character',draft_id:'c1',name:'林夏',aliases:[],role:'主角',appearance_bible:'黑色风衣',personality:'冷静',continuity_rules:'银色耳钉',negative_constraints:'',voice_speaker:'v1',voice_instruction:''}],episodes:[{draft_id:'e1',enabled:true,title:'第一集',premise:'发现芯片',target_duration_seconds:60,scenes:[{location:'天台',time_of_day:'night',summary:'追逐',continuity_state:{},props:[{name:'记忆芯片',description:'银色芯片',required:true}],estimated_duration_seconds:5,shots:[{shot_type:'wide',duration_seconds:5,composition:'天台',camera_motion:'push_in',character_state:{c1:{}},image_prompt:'roof',negative_prompt:'',dialogue:[]}]}]}],warnings:[]};
  const parsed={id:'i1',project_id:'p1',script_revision_id:'r1',status:'ready',mode:'auto',source_format:'paste',original_filename:'',checksum:'x',extracted_text:'第一集',structured_draft:structured,error:'',error_category:'',created_at:'',updated_at:'',applied_at:null,generated_episode_ids:[]};
  mocks.parse.mockResolvedValue(parsed);mocks.updateImport.mockResolvedValue(parsed);mocks.confirmImport.mockResolvedValue({...parsed,status:'applied'});
});
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('loads the project script and shows its versions instead of a script list',async()=>{
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);
  expect(await screen.findByLabelText('剧本正文')).toHaveValue('第一集');
  expect(screen.getByRole('complementary',{name:'剧本版本'})).toHaveTextContent('V1');
  expect(screen.queryByRole('button',{name:'新建剧本'})).not.toBeInTheDocument();
  expect(mocks.list).toHaveBeenCalledWith('p1');
  expect(mocks.get).toHaveBeenCalledWith('s1');
});

it('offers only upload and AI generation when the project has no script',async()=>{
  mocks.list.mockResolvedValueOnce([]);
  const user=userEvent.setup();
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);
  const upload=await screen.findByLabelText('上传剧本');
  expect(upload).toHaveClass('sr-only');
  expect(screen.getByText('上传剧本')).toBeVisible();
  await user.click(screen.getByRole('button',{name:'AI 根据条件生成'}));
  await user.type(screen.getByRole('textbox',{name:'AI 创作条件'}),'三集悬疑故事');
  await user.click(screen.getByRole('button',{name:'开始生成'}));
  expect(mocks.create).toHaveBeenCalledWith('p1',{title:'项目剧本',source_type:'ai',content:''});
  expect(mocks.stream).toHaveBeenCalledWith('s1',{brief:'三集悬疑故事',expected_revision_id:'r1'},expect.any(Object),expect.any(AbortSignal));
});

it('saves a draft explicitly and then creates an immutable version',async()=>{
  const onConfirmed=vi.fn();
  const user=userEvent.setup();
  render(<ScriptLibrary projectId="p1" onConfirmed={onConfirmed}/>);
  const editor=await screen.findByLabelText('剧本正文');
  fireEvent.change(editor,{target:{value:'第二版'}});
  expect(mocks.patch).not.toHaveBeenCalled();
  const saveButton=screen.getByRole('button',{name:'保存草稿'});
  await waitFor(()=>expect(saveButton).toBeEnabled());
  await user.click(saveButton);
  await waitFor(()=>expect(mocks.patch).toHaveBeenCalledWith('s1',{content:'第二版',expected_checksum:'old'}));
  await user.click(screen.getByRole('button',{name:'创建版本'}));
  expect(mocks.finalize).toHaveBeenCalledWith('s1');
  expect(onConfirmed).toHaveBeenCalledTimes(1);
});

it('renames and deletes the selected script',async()=>{
  const user=userEvent.setup();
  vi.stubGlobal('confirm',vi.fn(()=>true));
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);
  const toolbar=await screen.findByRole('group',{name:'剧本命令'});
  fireEvent.click(within(toolbar).getByRole('button',{name:'重命名'}));
  const title=await screen.findByLabelText('剧本标题');await user.clear(title);await user.type(title,'新版标题');await user.keyboard('{Enter}');
  await waitFor(()=>expect(mocks.patch).toHaveBeenCalledWith('s1',{title:'新版标题'}));
  await user.click(within(toolbar).getByRole('button',{name:'删除剧本'}));
  await waitFor(()=>expect(mocks.remove).toHaveBeenCalledWith('s1'));
});

it('uploads a new version into the same script and restores history',async()=>{
  const user=userEvent.setup();
  vi.stubGlobal('confirm',vi.fn(()=>true));
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);
  const file=new File(['第一集'],'story.txt',{type:'text/plain'});
  await user.upload(await screen.findByLabelText('上传新版本'),file);
  await waitFor(()=>expect(mocks.upload).toHaveBeenCalledWith('p1','story',file));
  await user.click(await screen.findByRole('button',{name:'版本历史'}));
  expect(await screen.findByText('版本 1')).toBeVisible();
  await user.click(screen.getByRole('button',{name:'恢复版本 1'}));
  await waitFor(()=>expect(mocks.restore).toHaveBeenCalledWith('s1','r1'));
});

it('switches to a historical markdown preview and can restore or delete it',async()=>{
  const user=userEvent.setup();
  vi.stubGlobal('confirm',vi.fn(()=>true));
  const current={...revision('# 第二版'),id:'r2',revision_number:2,status:'finalized' as const,creation_method:'ai'};
  const first={...revision('# 第一版'),id:'r1',revision_number:1,status:'finalized' as const};
  const restored={...first,id:'r3',revision_number:3,creation_method:'restore'};
  mocks.get.mockResolvedValueOnce({...document,status:'ready',current_revision_id:'r2',current_revision:current,revision_count:2});
  mocks.revisions.mockResolvedValue([current,first]);
  mocks.restore.mockImplementationOnce(async()=>{
    mocks.get.mockResolvedValue({...document,status:'ready',current_revision_id:'r3',current_revision:restored,revision_count:3});
    mocks.revisions.mockResolvedValue([restored,current,first]);
    return {...document,status:'ready',current_revision_id:'r3',current_revision:restored,revision_count:3};
  });
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);

  await user.click(await screen.findByRole('button',{name:'查看版本 1'}));
  expect(screen.getByRole('heading',{name:'第一版'})).toBeVisible();
  expect(screen.queryByRole('textbox',{name:'剧本正文'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'恢复版本 1'}));
  await waitFor(()=>expect(mocks.restore).toHaveBeenCalledWith('s1','r1'));

  await user.click(screen.getByRole('button',{name:'查看版本 1'}));
  await user.click(screen.getByRole('button',{name:'删除版本 1'}));
  await waitFor(()=>expect(mocks.removeRevision).toHaveBeenCalledWith('s1','r1'));
});

it('renders finalized markdown by default and switches the current version into edit mode',async()=>{
  const user=userEvent.setup();
  const current={...revision('# 第二版\n\n**正文**'),id:'r2',revision_number:2,status:'finalized' as const,creation_method:'ai'};
  mocks.get.mockResolvedValueOnce({...document,status:'ready',current_revision_id:'r2',current_revision:current});
  mocks.revisions.mockResolvedValue([current]);
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);

  expect(await screen.findByRole('heading',{name:'第二版'})).toBeVisible();
  expect(screen.queryByRole('textbox',{name:'剧本正文'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'编辑正文'}));
  expect(screen.getByRole('textbox',{name:'剧本正文'})).toHaveValue('# 第二版\n\n**正文**');
  expect(screen.getByRole('button',{name:'AI 生成新版本'})).toHaveClass('script-ai-version-button');
});

it('opens the new AI version before streaming chunks into its editor',async()=>{
  const user=userEvent.setup();
  const next={...revision('', 'next'),id:'r2',revision_number:2,status:'working' as const,creation_method:'ai'};
  let finish:()=>void=()=>{};
  mocks.stream.mockImplementationOnce(async(_id,_data,handlers)=>{
    handlers.onStarted(next);
    handlers.onChunk({text:'# 新版本',revision_id:'r2',persisted_length:5});
    await new Promise<void>(resolve=>{finish=resolve;});
    handlers.onDone({revision_id:'r2'});
  });
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);

  await user.click(await screen.findByRole('button',{name:'AI 生成新版本'}));
  await user.type(screen.getByRole('textbox',{name:'AI 创作条件'}),'加强悬疑');
  await user.click(screen.getByRole('button',{name:'开始生成'}));

  expect(await screen.findByRole('button',{name:'查看版本 2'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('textbox',{name:'剧本正文'})).toHaveValue('# 新版本');
  expect(screen.queryByRole('textbox',{name:'AI 创作条件'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'停止生成'})).toBeVisible();

  const finalized={...next,status:'finalized' as const,content:'# 新版本'};
  mocks.get.mockResolvedValue({...document,status:'ready',revision_count:2,current_revision_id:'r2',current_revision:finalized});
  mocks.revisions.mockResolvedValue([finalized,document.current_revision]);
  finish();
  await waitFor(()=>expect(screen.queryByRole('button',{name:'停止生成'})).not.toBeInTheDocument());
});

it('parses the current script into a reviewable episode draft before confirmation',async()=>{
  const onConfirmed=vi.fn();
  const user=userEvent.setup();
  render(<ScriptLibrary projectId="p1" onConfirmed={onConfirmed}/>);

  await user.click(await screen.findByRole('button',{name:'解析为剧集'}));
  expect(mocks.parse).toHaveBeenCalledWith('s1');
  expect(await screen.findByRole('heading',{name:'场景道具'})).toBeVisible();
  expect(screen.getByLabelText('第 1 集第 1 场道具 1 名称')).toHaveValue('记忆芯片');
  await user.click(screen.getByRole('button',{name:'确认导入'}));
  await waitFor(()=>expect(mocks.updateImport).toHaveBeenCalledWith('i1',expect.objectContaining({episodes:expect.any(Array)})));
  expect(mocks.confirmImport).toHaveBeenCalledWith('i1');
  expect(onConfirmed).toHaveBeenCalled();
});

it('contains the horizontal version strip inside the mobile viewport',()=>{
  expect(workspaceStyles).toMatch(/@media\s*\(max-width:\s*899px\)[\s\S]*\.script-library-list\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/);
  expect(workspaceStyles).toMatch(/@media\s*\(max-width:\s*899px\)[\s\S]*\.script-library-main\s*\{[^}]*min-width:\s*0/);
  expect(workspaceStyles).toMatch(/@media\s*\(max-width:\s*899px\)[\s\S]*\.script-version-actions\s*\{[^}]*flex-wrap:\s*wrap/);
});

it('opens the storyline canvas without replacing the script document',async()=>{
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);
  expect(await screen.findByLabelText('剧本正文')).toHaveValue('第一集');

  await userEvent.click(screen.getByRole('button',{name:'故事线画布'}));

  expect(screen.getByRole('heading',{name:'故事线画布'})).toBeVisible();
  expect(screen.getByText('海底异变')).toBeVisible();
  expect(screen.getByRole('button',{name:'真实时间裂缝'})).toBeVisible();
  expect(screen.getByRole('button',{name:'海螺发光'})).toBeVisible();
  await userEvent.click(screen.getByRole('button',{name:'文档编辑'}));
  expect(screen.getByLabelText('剧本正文')).toHaveValue('第一集');
});

it('opens directly on a storyline selected from the work overview',async()=>{
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()} initialView="storyline" initialStorylineId="l1"/>);

  expect(await screen.findByRole('heading',{name:'故事线画布'})).toBeVisible();
  expect(screen.getByRole('button',{name:'真实时间裂缝'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('button',{name:'海螺发光'})).toBeVisible();
});
