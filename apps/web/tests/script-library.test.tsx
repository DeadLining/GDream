import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {ScriptLibrary} from '../components/ScriptLibrary';
import type {ScriptDocument, ScriptDocumentSummary} from '../lib/types';

const mocks=vi.hoisted(()=>({
  list:vi.fn(),get:vi.fn(),create:vi.fn(),patch:vi.fn(),remove:vi.fn(),upload:vi.fn(),revisions:vi.fn(),restore:vi.fn(),
}));

vi.mock('../lib/api',async importOriginal=>({
  ...await importOriginal<typeof import('../lib/api')>(),
  listScripts:mocks.list,getScript:mocks.get,createScript:mocks.create,
  patchScript:mocks.patch,deleteScript:mocks.remove,uploadScript:mocks.upload,
  listScriptRevisions:mocks.revisions,restoreScriptRevision:mocks.restore,
}));

const revision=(content='第一集',checksum='old')=>({id:'r1',document_id:'s1',revision_number:1,status:'working' as const,content,checksum,creation_method:'paste',original_filename:'',source_file_path:'',source_media_type:'',generation_brief:'',generation_metadata:{},created_at:'2026-07-12T00:00:00Z'});
const document:ScriptDocument={id:'s1',project_id:'p1',title:'雨夜',source_type:'paste',status:'draft',revision_count:1,current_revision_id:'r1',created_at:'2026-07-12T00:00:00Z',updated_at:'2026-07-12T01:00:00Z',current_revision:revision(),latest_import_id:null,parse_is_stale:false};
const summary:ScriptDocumentSummary={...document};

beforeEach(()=>{
  mocks.list.mockResolvedValue([summary]);mocks.get.mockResolvedValue(document);
  mocks.create.mockResolvedValue(document);mocks.patch.mockImplementation(async(_id,data)=>({...document,title:data.title??document.title,current_revision:{...document.current_revision,content:data.content??document.current_revision.content,checksum:'new'}}));mocks.remove.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue({...document,id:'upload-1',title:'story',source_type:'upload'});mocks.revisions.mockResolvedValue([{...revision(),status:'finalized'}]);mocks.restore.mockResolvedValue({...document,current_revision:{...revision(),id:'r2',revision_number:2,status:'finalized'}});
});
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('loads project scripts and selects the newest document',async()=>{
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);
  expect(await screen.findByRole('button',{name:/雨夜/})).toBeVisible();
  expect(await screen.findByLabelText('剧本正文')).toHaveValue('第一集');
  expect(mocks.list).toHaveBeenCalledWith('p1');
  expect(mocks.get).toHaveBeenCalledWith('s1');
});

it('creates the first script from the empty state',async()=>{
  mocks.list.mockResolvedValueOnce([]);
  const user=userEvent.setup();
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);
  await user.click(await screen.findByRole('button',{name:'新建剧本'}));
  expect(mocks.create).toHaveBeenCalledWith('p1',{title:'未命名剧本',source_type:'paste',content:''});
  expect(await screen.findByLabelText('剧本正文')).toBeVisible();
});

it('autosaves edited content and reports the server result',async()=>{
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);
  const editor=await screen.findByLabelText('剧本正文');
  fireEvent.change(editor,{target:{value:'第二版'}});
  expect(screen.getByText('正在保存')).toBeVisible();
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,650));});
  await waitFor(()=>expect(mocks.patch).toHaveBeenCalledWith('s1',{content:'第二版',expected_checksum:'old'}));
  expect(await screen.findByText('已保存')).toBeVisible();
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

it('uploads a script and restores a historical revision',async()=>{
  const user=userEvent.setup();
  vi.stubGlobal('confirm',vi.fn(()=>true));
  render(<ScriptLibrary projectId="p1" onConfirmed={vi.fn()}/>);
  const file=new File(['第一集'],'story.txt',{type:'text/plain'});
  await user.upload(await screen.findByLabelText('上传剧本'),file);
  await waitFor(()=>expect(mocks.upload).toHaveBeenCalledWith('p1','story',file));
  await user.click(await screen.findByRole('button',{name:'版本历史'}));
  expect(await screen.findByText('版本 1')).toBeVisible();
  await user.click(screen.getByRole('button',{name:'恢复版本 1'}));
  await waitFor(()=>expect(mocks.restore).toHaveBeenCalledWith('upload-1','r1'));
});
