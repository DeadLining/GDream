import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ReviewPanel} from '../components/ReviewPanel';
import type {EpisodeDetail, ProductionReadiness} from '../lib/types';

const episode: EpisodeDetail = {
  id: 'episode-1', project_id: 'project-1', title: '失窃的雨夜', premise: '寻找芯片',
  target_duration_seconds: 60, status: 'planned', created_at: '', updated_at: '',
  scenes: [{
    id: 'scene-1', position: 1, location: '雨夜巷道', time_of_day: 'night', summary: '发现芯片',
    continuity_state: {}, estimated_duration_seconds: 10,
    shots: [
      {id: 'shot-1', position: 1, shot_type: 'wide', duration_seconds: 4, composition: '进入巷道', camera_motion: 'push_in', character_state: {}, image_prompt: '', negative_prompt: '', active_panel_asset_id: 'asset-1', review_status: 'approved', render_status: 'completed', dialogue: []},
      {id: 'shot-2', position: 2, shot_type: 'close_up', duration_seconds: 3, composition: '拾起芯片', camera_motion: 'still', character_state: {}, image_prompt: '', negative_prompt: '', active_panel_asset_id: null, review_status: 'draft', render_status: 'pending', dialogue: []},
      {id: 'shot-3', position: 3, shot_type: 'medium', duration_seconds: 3, composition: '观察芯片', camera_motion: 'still', character_state: {}, image_prompt: '', negative_prompt: '', active_panel_asset_id: 'asset-3', review_status: 'draft', render_status: 'completed', dialogue: []},
    ],
  }],
};

const readiness: ProductionReadiness = {
  episode_id: 'episode-1', ready: false,
  totals: {shots: 3, dialogue: 0}, ready_counts: {panels: 2, approved: 1, speech: 0},
  blockers: {missing_panels: ['shot-2'], unapproved_shots: ['shot-2', 'shot-3'], missing_speech: []},
};

describe('ReviewPanel', () => {
  afterEach(cleanup);

  it('derives one row per blocker shot and deduplicates blocker labels', () => {
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={() => {}} />);

    expect(screen.getByRole('heading', {name: '审核队列'})).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', {name: /镜头 2/})).toHaveTextContent('缺少画面');
    expect(screen.getByRole('button', {name: /镜头 2/})).toHaveTextContent('待审核');
    expect(screen.getByRole('button', {name: /镜头 3/})).toHaveTextContent('待审核');
    expect(screen.queryByRole('button', {name: /镜头 1/})).not.toBeInTheDocument();
  });

  it('routes a blocker row to the existing shot selection callback', async () => {
    const onSelectShot = vi.fn();
    render(<ReviewPanel episode={episode} readiness={readiness} onSelectShot={onSelectShot} />);

    await userEvent.click(screen.getByRole('button', {name: /镜头 2/}));

    expect(onSelectShot).toHaveBeenCalledWith('shot-2');
  });
});
