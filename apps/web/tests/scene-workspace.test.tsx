import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SceneWorkspace} from '../components/SceneWorkspace';
import type {EpisodeDetail} from '../lib/types';

const mocks=vi.hoisted(()=>({updateScene:vi.fn(),createShot:vi.fn(),reorderScenes:vi.fn(),getEpisode:vi.fn(),createRun:vi.fn()}));
vi.mock('../lib/api',()=>({
  updateScene:mocks.updateScene,
  createScene:vi.fn(),
  deleteScene:vi.fn(),
  reorderScenes:mocks.reorderScenes,
  createStructureShot:mocks.createShot,
  deleteStructureShot:vi.fn(),
  reorderShots:vi.fn(),
  updateShot:vi.fn(),
  getEpisode:mocks.getEpisode,
  createProductionRun:mocks.createRun,
}));

const episode: EpisodeDetail = {
  id: 'episode-1', project_id: 'project-1', title: '穿越时空', premise: '发现时间裂缝',
  target_duration_seconds: 60, status: 'planned', created_at: '', updated_at: '',
  scenes: [
    {id: 'scene-1', position: 1, location: '废弃实验室', time_of_day: 'night', summary: '发现怀表', continuity_state: {weather: 'rain'}, estimated_duration_seconds: 28, shots: [
      {id: 'shot-1', position: 1, shot_type: 'wide_shot', duration_seconds: 8, composition: '进入实验室', camera_motion: 'push_in', character_state: {}, image_prompt: '', negative_prompt: '', active_panel_asset_id: null, review_status: 'draft', render_status: 'pending', dialogue: []},
    ]},
    {id: 'scene-2', position: 2, location: '时间裂缝', time_of_day: 'dawn', summary: '裂缝启动', continuity_state: {}, estimated_duration_seconds: 32, shots: [
      {id: 'shot-2', position: 1, shot_type: 'close_up', duration_seconds: 10, composition: '怀表发光', camera_motion: 'still', character_state: {}, image_prompt: '', negative_prompt: '', active_panel_asset_id: null, review_status: 'approved', render_status: 'completed', dialogue: []},
    ]},
  ],
};

describe('SceneWorkspace', () => {
  afterEach(()=>{cleanup();vi.clearAllMocks();});

  it('switches scenes and exposes their production beats', async () => {
    const onOpenShot = vi.fn();
    render(<SceneWorkspace episode={episode} onOpenShot={onOpenShot}/>);

    expect(screen.getByRole('heading', {name: '废弃实验室'})).toBeVisible();
    expect(screen.getByText('进入实验室')).toBeVisible();

    await userEvent.click(screen.getByRole('button', {name: '场景 02 时间裂缝'}));

    expect(screen.getByRole('heading', {name: '时间裂缝'})).toBeVisible();
    await userEvent.click(screen.getByRole('button', {name: '打开镜头 01'}));
    expect(onOpenShot).toHaveBeenCalledWith('shot-2');
  });

  it('edits a scene and offers a scoped rerun for invalidated shots',async()=>{
    const updated={...episode,scenes:[{...episode.scenes[0],location:'霓虹旧巷'},episode.scenes[1]]};
    mocks.updateScene.mockResolvedValue({episode_id:'episode-1',resource_id:'scene-1',affected_shot_ids:['shot-1'],invalidated_stages:['panels','videos']});
    mocks.getEpisode.mockResolvedValue(updated);
    mocks.createRun.mockResolvedValue({id:'run-1'});
    render(<SceneWorkspace episode={episode} onOpenShot={vi.fn()}/>);

    await userEvent.click(screen.getByRole('button',{name:'编辑当前场景'}));
    const location=screen.getByRole('textbox',{name:'场景地点'});
    await userEvent.clear(location);
    await userEvent.type(location,'霓虹旧巷');
    await userEvent.click(screen.getByRole('button',{name:'保存场景'}));

    await waitFor(()=>expect(mocks.updateScene).toHaveBeenCalledWith('scene-1',expect.objectContaining({location:'霓虹旧巷'})));
    expect(await screen.findByRole('heading',{name:'霓虹旧巷'})).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'补跑受影响的 1 个镜头'}));
    expect(mocks.createRun).toHaveBeenCalledWith('episode-1',expect.objectContaining({shot_ids:['shot-1'],regenerate_panels:true,regenerate_videos:true}));
  });

  it('adds a shot and reorders scenes',async()=>{
    mocks.createShot.mockResolvedValue({episode_id:'episode-1',resource_id:'shot-3',affected_shot_ids:['shot-3'],invalidated_stages:['panels','videos']});
    mocks.reorderScenes.mockResolvedValue({episode_id:'episode-1',resource_id:'episode-1',affected_shot_ids:['shot-1','shot-2'],invalidated_stages:['panels','videos']});
    mocks.getEpisode.mockResolvedValue(episode);
    render(<SceneWorkspace episode={episode} onOpenShot={vi.fn()}/>);

    await userEvent.click(screen.getByRole('button',{name:'新增镜头'}));
    await userEvent.type(screen.getByRole('textbox',{name:'镜头构图'}),'角色回望入口');
    await userEvent.type(screen.getByRole('textbox',{name:'画面提示词'}),'look back at entrance');
    await userEvent.click(screen.getByRole('button',{name:'保存新镜头'}));
    await waitFor(()=>expect(mocks.createShot).toHaveBeenCalledWith('scene-1',expect.objectContaining({composition:'角色回望入口'})));

    await userEvent.click(screen.getByRole('button',{name:'下移场景 01'}));
    expect(mocks.reorderScenes).toHaveBeenCalledWith('episode-1',['scene-2','scene-1']);
  });
});
