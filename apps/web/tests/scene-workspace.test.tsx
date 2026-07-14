import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SceneWorkspace} from '../components/SceneWorkspace';
import type {EpisodeDetail} from '../lib/types';

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
  afterEach(cleanup);

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
});
