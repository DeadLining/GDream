import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {ProductionMediaWorkspace} from '../components/production-canvas/ProductionMediaWorkspace';
import {ApiError} from '../lib/api/core';
import type {Asset,Job,Shot} from '../lib/types';

const mocks=vi.hoisted(()=>({listPanelVersions:vi.fn(),listVideoVersions:vi.fn(),getShotGenerationReadiness:vi.fn(),getShotGenerationContext:vi.fn(),updateShot:vi.fn(),startPanelGeneration:vi.fn(),startVideoGeneration:vi.fn(),activatePanel:vi.fn(),activateVideo:vi.fn(),suggestMediaPrompt:vi.fn(),pollJob:vi.fn()}));
vi.mock('../lib/api',()=>({...mocks,mediaUrl:(path:string)=>path}));
vi.mock('../lib/jobs',()=>({pollJob:mocks.pollJob}));

const shot:Shot={id:'shot-1',position:1,shot_type:'close_up',duration_seconds:3,composition:'回头示警',camera_motion:'push_in',character_state:{},image_prompt:'雨夜近景',negative_prompt:'变形',video_prompt:'缓慢推近',negative_video_prompt:'闪烁',active_panel_asset_id:'panel-1',active_video_asset_id:null,review_status:'approved',render_status:'completed',video_render_status:'pending',dialogue:[]};
const panel:Asset={id:'panel-1',kind:'panel',media_url:'/media/panel.png',media_type:'image/png',provider:'openai',model:'gpt-image-2',generation_attempt:1,review_status:'approved',width:1024,height:1536,duration_seconds:null,created_at:''};
const panelTwo={...panel,id:'panel-2',media_url:'/media/panel-2.png',generation_attempt:2};
const video:Asset={...panel,id:'video-1',kind:'video',media_url:'/media/video.mp4',media_type:'video/mp4',duration_seconds:3};
const succeeded:Job={id:'job-1',operation:'generate_panel',target_type:'shot',target_id:'shot-1',status:'succeeded',progress:100,result_metadata:{asset_id:'panel-2'},error:'',retry_count:0,created_at:'',updated_at:''};

describe('ProductionMediaWorkspace',()=>{
  afterEach(cleanup);
  beforeEach(()=>{vi.clearAllMocks();mocks.listPanelVersions.mockResolvedValue([panel]);mocks.listVideoVersions.mockResolvedValue([]);mocks.getShotGenerationReadiness.mockResolvedValue({shot_id:'shot-1',project_id:'project-1',script_revision_id:'revision-1',ready:true,asset_ready:true,blocking_ready:true,camera_ready:true,blockers:[],requirement_ids:[]});mocks.getShotGenerationContext.mockResolvedValue({shot_id:'shot-1',mode:'panel',snapshot_hash:'hash-1',prompt_constraints:'Bound production inputs:\n- Camera framing: medium, 85mm\n- Subject blocking: character 林夏站位; position [2, 0, -1]; horizontal facing 90 degrees',library_assets:[{id:'scene-asset',kind:'scene',name:'雨夜天台',description:'湿润水泥地和霓虹护栏',tags:['雨夜']}],director:{environment:{rain:true},camera:{position:[1,2,6],target:[0,1,0],rotation:[0,0,0],focal_length_mm:85,shot_size:'medium',camera_motion:'push_in',framing_guides:{}},objects:[{id:'object-1',kind:'character',source_type:'placeholder',source_id:null,label:'林夏站位',position:[2,0,-1],horizontal_facing_degrees:90}]},references:[{asset_id:'preview-1',label:'镜头 01 · 构图参考',role:'director_preview',guidance_kind:null,media_url:'/media/director-preview.png',media_type:'image/png'},{asset_id:'scene-media',label:'雨夜天台 · 场景背景',role:'bound_asset',guidance_kind:null,media_url:'/media/scene.png',media_type:'image/png'}]});mocks.updateShot.mockImplementation(async(_id,data)=>({...shot,...data}));mocks.pollJob.mockResolvedValue(succeeded);});

  it('saves panel prompts, generates a version, and activates a selected version',async()=>{
    const user=userEvent.setup();
    const onShotUpdated=vi.fn();
    mocks.startPanelGeneration.mockResolvedValue({job_id:'job-1',status:'queued'});
    mocks.listPanelVersions.mockResolvedValueOnce([panel]).mockResolvedValueOnce([panel,panelTwo]);
    mocks.activatePanel.mockResolvedValue({...shot,active_panel_asset_id:'panel-2'});
    render(<ProductionMediaWorkspace mode="panel" shot={shot} onBackToProduction={vi.fn()} onShotUpdated={onShotUpdated}/>);

    expect(await screen.findByRole('heading',{name:'分镜生成'})).toBeVisible();
    await user.clear(screen.getByLabelText('分镜提示词'));await user.type(screen.getByLabelText('分镜提示词'),'新的雨夜构图');
    await user.click(screen.getByRole('button',{name:'生成新分镜'}));

    await waitFor(()=>expect(mocks.updateShot).toHaveBeenCalledWith('shot-1',expect.objectContaining({image_prompt:'新的雨夜构图',negative_prompt:'变形'})));
    expect(mocks.startPanelGeneration).toHaveBeenCalledWith('shot-1',true);
    expect(await screen.findByRole('button',{name:'分镜版本 2'})).toBeVisible();
    await user.click(screen.getByRole('button',{name:'分镜版本 2'}));
    expect(mocks.activatePanel).toHaveBeenCalledWith('shot-1','panel-2');
  });

  it('shows the exact auto-applied generation context without changing the base prompt',async()=>{
    const user=userEvent.setup();
    render(<ProductionMediaWorkspace mode="panel" shot={shot} onBackToProduction={vi.fn()} onShotUpdated={vi.fn()}/>);

    const context=await screen.findByRole('group',{name:'生成时自动附加'});
    expect(context).toHaveTextContent('85mm');
    expect(context).toHaveTextContent('林夏站位');
    expect(context).toHaveTextContent('位置 2, 0, -1');
    expect(context).toHaveTextContent('朝向 90°');
    expect(context).toHaveTextContent('雨夜天台');
    expect(context).toHaveTextContent('2 张参考图');
    expect(context).toHaveTextContent('参考图 1');
    expect(context).toHaveTextContent('镜头 01 · 构图参考');
    expect(context).toHaveTextContent('参考图 2');
    expect(context).toHaveTextContent('雨夜天台 · 场景背景');
    expect(screen.getByRole('img',{name:'参考图 1·构图参考'})).toHaveAttribute('src','/media/director-preview.png');
    expect(screen.getByRole('img',{name:'参考图 2·绑定素材'})).toHaveAttribute('src','/media/scene.png');
    await user.click(screen.getByRole('button',{name:'查看参考图 1：镜头 01 · 构图参考'}));
    const preview=screen.getByRole('dialog',{name:'参考图预览'});
    expect(preview).toHaveTextContent('镜头 01 · 构图参考');
    expect(screen.getByRole('img',{name:'镜头 01 · 构图参考大图'})).toHaveAttribute('src','/media/director-preview.png');
    await user.click(screen.getByRole('button',{name:'关闭参考图预览'}));
    expect(screen.queryByRole('dialog',{name:'参考图预览'})).not.toBeInTheDocument();
    expect(screen.getByLabelText('分镜提示词')).toHaveValue('雨夜近景');
    expect(screen.getByLabelText('分镜提示词')).not.toHaveValue(expect.stringContaining('Director camera'));
  });

  it('generates video from the approved active panel and activates video versions',async()=>{
    const user=userEvent.setup();
    mocks.startVideoGeneration.mockResolvedValue({job_id:'video-job',status:'queued'});
    mocks.pollJob.mockResolvedValue({...succeeded,id:'video-job',operation:'generate_video',result_metadata:{asset_id:'video-1'}});
    mocks.listVideoVersions.mockResolvedValueOnce([]).mockResolvedValueOnce([video]);
    mocks.activateVideo.mockResolvedValue({...shot,active_video_asset_id:'video-1'});
    render(<ProductionMediaWorkspace mode="video" shot={shot} onBackToProduction={vi.fn()} onShotUpdated={vi.fn()}/>);

    expect(await screen.findByRole('heading',{name:'视频生成'})).toBeVisible();
    await user.click(screen.getByRole('button',{name:'生成新视频'}));

    expect(mocks.updateShot).toHaveBeenCalledWith('shot-1',expect.objectContaining({video_prompt:'缓慢推近',negative_video_prompt:'闪烁'}));
    expect(mocks.startVideoGeneration).toHaveBeenCalledWith('shot-1',true);
    await user.click(await screen.findByRole('button',{name:'视频版本 1'}));
    expect(mocks.activateVideo).toHaveBeenCalledWith('shot-1','video-1');
  });

  it('keeps video generation disabled without an approved active panel',async()=>{
    render(<ProductionMediaWorkspace mode="video" shot={{...shot,active_panel_asset_id:null,review_status:'draft'}} onBackToProduction={vi.fn()} onShotUpdated={vi.fn()}/>);
    expect(await screen.findByRole('button',{name:'生成新视频'})).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('请先生成分镜并完成视觉审阅');
  });
;

  it('shows prompt save failures without leaving an unhandled action',async()=>{
    mocks.updateShot.mockRejectedValue(new Error('提示词保存失败'));
    render(<ProductionMediaWorkspace mode="panel" shot={shot} onBackToProduction={vi.fn()} onShotUpdated={vi.fn()}/>);

    await userEvent.click(await screen.findByRole('button',{name:'保存提示词'}));

    expect(await screen.findByRole('alert')).toHaveTextContent('提示词保存失败');
    expect(screen.getByRole('button',{name:'保存提示词'})).toBeEnabled();
  });
;

  it('fills an AI prompt draft without saving or generating automatically',async()=>{
    mocks.suggestMediaPrompt.mockResolvedValue({mode:'panel',prompt:'AI 建议的雨夜近景',negative_prompt:'身份漂移，文字',rationale:'结合角色与连续性',used_context:['character','previous_shot','director_camera','director_blocking','library_assets','visual_review']});
    render(<ProductionMediaWorkspace mode="panel" shot={shot} onBackToProduction={vi.fn()} onShotUpdated={vi.fn()}/>);

    await userEvent.click(await screen.findByRole('button',{name:'AI 生成提示词'}));

    expect(screen.getByLabelText('分镜提示词')).toHaveValue('AI 建议的雨夜近景');
    expect(screen.getByLabelText('分镜负面提示词')).toHaveValue('身份漂移，文字');
    expect(screen.getByText('结合角色与连续性')).toBeVisible();
    expect(screen.getByText(/视觉审阅/)).toBeVisible();
    expect(screen.getByText(/主体站位与空间关系/)).toBeVisible();
    expect(screen.getByText(/场景与道具资产/)).toBeVisible();
    expect(screen.queryByText(/visual_review/)).not.toBeInTheDocument();
    expect(mocks.updateShot).not.toHaveBeenCalled();
    expect(mocks.startPanelGeneration).not.toHaveBeenCalled();
  });

  it('returns to the mounted production canvas',async()=>{
    const onBack=vi.fn();
    render(<ProductionMediaWorkspace mode="panel" shot={shot} onBackToProduction={onBack} onShotUpdated={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button',{name:'返回生产画布'}));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
