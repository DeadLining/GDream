import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ProjectSettings} from '../components/ProjectSettings';
import type {ProjectDetail,Volume} from '../lib/types';

const portabilityMocks=vi.hoisted(()=>({exportProject:vi.fn(),importProject:vi.fn(),projectExportDownloadUrl:vi.fn()}));
vi.mock('../lib/api',()=>portabilityMocks);

const project:ProjectDetail={id:'p1',title:'星轨计划',logline:'寻找失落坐标',story_bible:'三卷结构',visual_style:'cinematic anime',aspect_ratio:'16:9',language:'Chinese',created_at:'',updated_at:'',characters:[],episodes:[{id:'e1',project_id:'p1',title:'启航',premise:'发现坐标',target_duration_seconds:480,status:'planned',created_at:'',updated_at:''}]};
const volumes:Volume[]=[{id:'v1',project_id:'p1',position:1,title:'启航篇',summary:'',created_at:'',updated_at:'',episodes:[{...project.episodes[0],volume_id:'v1',position:1}]}];

describe('ProjectSettings',()=>{
  afterEach(cleanup);
  beforeEach(()=>{
    vi.clearAllMocks();
    portabilityMocks.exportProject.mockResolvedValue({project_id:'p1',zip_path:'/private/server/export.zip',bytes_written:2048});
    portabilityMocks.importProject.mockResolvedValue({project_id:'p2',warnings:[]});
    portabilityMocks.projectExportDownloadUrl.mockReturnValue('/api/projects/p1/export/download');
  });
  it('links every visible settings section and omits unavailable dangerous actions',async()=>{
    render(<ProjectSettings project={project} volumes={volumes} sceneCount={4} shotCount={28} onSave={()=>{}}/>);

    expect(screen.getByRole('link',{name:'基本信息'})).toHaveAttribute('href','#project-basic');
    expect(screen.getByRole('link',{name:'结构规则'})).toHaveAttribute('href','#project-structure');
    expect(screen.getByRole('link',{name:'生成规范'})).toHaveAttribute('href','#project-generation');
    expect(screen.getByRole('link',{name:'文件与存储'})).toHaveAttribute('href','#project-files');
    expect(screen.queryByRole('button',{name:'危险操作'})).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link',{name:'结构规则'}));
    expect(screen.getByRole('link',{name:'结构规则'})).toHaveAttribute('aria-current','location');
  });

  it('reports unsaved changes and clears them when edits are abandoned',async()=>{
    const onDirtyChange=vi.fn();
    render(<ProjectSettings project={project} volumes={volumes} sceneCount={4} shotCount={28} onSave={()=>{}} onDirtyChange={onDirtyChange}/>);

    expect(screen.getByRole('button',{name:'保存设置'})).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox',{name:'作品名称'}),' 2');
    await waitFor(()=>expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    expect(screen.getByRole('button',{name:'保存设置'})).toBeEnabled();

    await userEvent.click(screen.getByRole('button',{name:'放弃更改'}));
    await waitFor(()=>expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole('button',{name:'保存设置'})).toBeDisabled();
  });

  it('edits project basics while preserving the approved hierarchy rules',async()=>{
    const onSave=vi.fn().mockResolvedValue(undefined);
    render(<ProjectSettings project={project} volumes={volumes} sceneCount={4} shotCount={28} onSave={onSave}/>);

    expect(screen.getByText('作品 → 卷/篇章 → 集 → 场景 → 镜头')).toBeVisible();
    expect(screen.getByText('故事线是跨集标签关系，不影响卷与剧集排序。')).toBeVisible();
    const title=screen.getByRole('textbox',{name:'作品名称'});
    await userEvent.clear(title);
    await userEvent.type(title,'星轨纪元');
    await userEvent.click(screen.getByRole('radio',{name:'9:16'}));
    await userEvent.click(screen.getByRole('button',{name:'保存设置'}));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({title:'星轨纪元',aspect_ratio:'9:16'}));
  });

  it('downloads exports and reports imported projects to the workspace',async()=>{
    const onImported=vi.fn();
    render(<ProjectSettings project={project} volumes={volumes} sceneCount={4} shotCount={28} onSave={()=>{}} onImported={onImported}/>);

    await userEvent.click(screen.getByRole('button',{name:'导出 ZIP'}));
    expect(await screen.findByRole('link',{name:'下载工程 ZIP'})).toHaveAttribute('href','/api/projects/p1/export/download');

    const archive=new File(['zip-content'],'project.zip',{type:'application/zip'});
    await userEvent.upload(screen.getByLabelText('选择 ZIP 工程包'),archive);
    expect(portabilityMocks.importProject).toHaveBeenCalledWith(archive);
    expect(onImported).toHaveBeenCalledWith({project_id:'p2',warnings:[]});
  });
});
