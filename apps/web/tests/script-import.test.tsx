import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {cleanup,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ScriptImportWorkspace} from '../components/ScriptImportWorkspace';

const mocks=vi.hoisted(()=>({create:vi.fn(),upload:vi.fn(),parse:vi.fn(),update:vi.fn(),confirm:vi.fn()}));
vi.mock('../lib/api',()=>({createPastedScriptImport:mocks.create,uploadScriptImport:mocks.upload,parseScriptImport:mocks.parse,updateScriptImportDraft:mocks.update,confirmScriptImport:mocks.confirm}));
const draft={project:{title:'雨夜',logline:'追查芯片'},characters:[{draft_id:'c1',name:'林夏',aliases:[],role:'主角',appearance_bible:'黑色风衣',personality:'冷静',continuity_rules:'耳钉',negative_constraints:'',voice_speaker:'v1',voice_instruction:''}],episodes:[{draft_id:'e1',enabled:true,title:'第一集',premise:'发现芯片',target_duration_seconds:60,scenes:[{location:'天台',time_of_day:'night',summary:'追逐',continuity_state:{},estimated_duration_seconds:5,shots:[{shot_type:'wide',duration_seconds:5,composition:'天台',camera_motion:'push_in',character_state:{},image_prompt:'roof',negative_prompt:'',dialogue:[]}]}]}],warnings:[]};
const imported={id:'i1',project_id:'p1',status:'ready',mode:'auto',source_format:'paste',original_filename:'',checksum:'x',extracted_text:'剧本',structured_draft:draft,error:'',error_category:'',created_at:'',updated_at:'',applied_at:null};

beforeEach(()=>{vi.clearAllMocks();mocks.create.mockResolvedValue({...imported,status:'uploaded',structured_draft:{}});mocks.parse.mockResolvedValue(imported);mocks.update.mockResolvedValue(imported);mocks.confirm.mockResolvedValue({...imported,status:'applied'});});
afterEach(cleanup);

const workspaceStyles=readFileSync(resolve(process.cwd(),'app/globals.css'),'utf8');

it('defaults to AI generation and accepts an optional creation brief',async()=>{const user=userEvent.setup();render(<ScriptImportWorkspace projectId="p1" onConfirmed={()=>{}}/>);expect(screen.getByRole('heading',{name:'剧本创作'})).toBeVisible();const modes=screen.getByRole('group',{name:'创作模式'});expect(modes).toHaveClass('script-mode-segments');expect(within(modes).getAllByRole('button')).toHaveLength(2);expect(screen.getByRole('button',{name:'AI生成'})).toHaveClass('active','script-mode-segment');expect(screen.getByRole('button',{name:'AI生成'}).querySelector('svg')).not.toBeNull();expect(screen.getByRole('button',{name:'自动识别'})).toBeVisible();expect(screen.queryByRole('button',{name:'剧本'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'小说'})).not.toBeInTheDocument();await user.click(screen.getByRole('button',{name:'生成并预览'}));await waitFor(()=>expect(mocks.create).toHaveBeenCalledWith('p1','generate',''));});

it('uses a compact two-column selector that expands only on mobile',()=>{expect(workspaceStyles).toMatch(/\.script-mode-segments\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*width:\s*max-content/);expect(workspaceStyles).toMatch(/\.script-mode-segment\s*\{[^}]*height:\s*36px/);expect(workspaceStyles).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*\.script-mode-segments\s*\{[^}]*width:\s*100%/);});

it('parses edits and confirms an automatically recognized source',async()=>{const onConfirmed=vi.fn();const user=userEvent.setup();render(<ScriptImportWorkspace projectId="p1" onConfirmed={onConfirmed}/>);await user.click(screen.getByRole('button',{name:'自动识别'}));await user.type(screen.getByPlaceholderText('粘贴剧本、小说或故事文本'),'雨夜剧本');await user.click(screen.getByRole('button',{name:'解析并预览'}));await screen.findByDisplayValue('林夏');await user.clear(screen.getByDisplayValue('林夏'));await user.type(screen.getByDisplayValue(''),'林夏新版');await user.click(screen.getByRole('button',{name:/确认导入/}));await waitFor(()=>expect(mocks.confirm).toHaveBeenCalledWith('i1'));expect(mocks.update.mock.calls.at(-1)?.[1].characters[0].name).toBe('林夏新版');expect(onConfirmed).toHaveBeenCalled();});

it('can disable an episode before confirmation',async()=>{const user=userEvent.setup();render(<ScriptImportWorkspace projectId="p1" onConfirmed={()=>{}}/>);await user.click(screen.getByRole('button',{name:'自动识别'}));await user.type(screen.getByPlaceholderText('粘贴剧本、小说或故事文本'),'剧本');await user.click(screen.getByRole('button',{name:'解析并预览'}));await user.click(await screen.findByRole('checkbox',{name:'导入第 1 集'}));await user.click(screen.getByRole('button',{name:/保存修改/}));await waitFor(()=>expect(mocks.update).toHaveBeenCalled());expect(mocks.update.mock.calls[0][1].episodes[0].enabled).toBe(false);});
