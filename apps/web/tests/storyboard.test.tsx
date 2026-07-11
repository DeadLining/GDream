import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Storyboard} from '../components/Storyboard';
import type {EpisodeDetail, Shot} from '../lib/types';

const makeShot = (overrides: Partial<Shot>): Shot => ({
  id: 'shot-1', position: 1, shot_type: 'close_up', duration_seconds: 5,
  composition: '林默在雨夜巷道中回头，霓虹映在湿润的地面上。', camera_motion: 'push_in',
  character_state: {}, image_prompt: 'comic close-up', negative_prompt: '',
  active_panel_asset_id: null, review_status: 'draft', render_status: 'pending', dialogue: [],
  ...overrides,
});

const shots = [
  makeShot({id: 'shot-1', position: 1}),
  makeShot({id: 'shot-2', position: 2, shot_type: 'medium_shot', active_panel_asset_id: 'asset-2', review_status: 'approved'}),
  makeShot({id: 'shot-3', position: 3, render_status: 'failed'}),
];

const episode: EpisodeDetail = {
  id: 'episode-1', project_id: 'project-1', title: '雨夜追踪', premise: '林默追查失踪芯片。',
  target_duration_seconds: 60, status: 'draft', created_at: '', updated_at: '',
  scenes: [{
    id: 'scene-1', position: 1, location: '旧城巷道', time_of_day: 'night', summary: '林默发现追踪者。',
    continuity_state: {}, estimated_duration_seconds: 15, shots,
  }],
};

describe('Storyboard', () => {
  afterEach(cleanup);

  it('groups shots under compact scene metadata', () => {
    render(<Storyboard episode={episode} selectedId={null} onSelect={vi.fn()} onPlan={vi.fn()} job={null}/>);
    expect(screen.getByRole('heading', {name: '旧城巷道'})).toBeVisible();
    expect(screen.getByText('场景 1')).toBeVisible();
    expect(screen.getByText('林默发现追踪者。')).toBeVisible();
    expect(screen.getByText('15s')).toBeVisible();
  });

  it('shows stable shot metadata and accessible status text', () => {
    render(<Storyboard episode={episode} selectedId="shot-1" onSelect={vi.fn()} onPlan={vi.fn()} job={null}/>);
    const selected = screen.getByRole('button', {name: /镜头 1/});
    expect(selected).toHaveTextContent('特写');
    expect(selected).toHaveTextContent('5s');
    expect(selected).toHaveTextContent('待审核');
    expect(selected).toHaveTextContent('缺少画面');
    expect(selected).toHaveAccessibleName(/已选中/);
    expect(screen.getByRole('button', {name: /镜头 2/})).toHaveTextContent('中景');
    expect(screen.getByRole('button', {name: /镜头 2/})).toHaveTextContent('已通过');
    expect(screen.getByRole('button', {name: /镜头 3/})).toHaveTextContent('生成失败');
  });

  it('selects a shot without exposing generation actions on cards', async () => {
    const onSelect = vi.fn();
    render(<Storyboard episode={episode} selectedId={null} onSelect={onSelect} onPlan={vi.fn()} job={null}/>);
    await userEvent.click(screen.getByRole('button', {name: /镜头 2/}));
    expect(onSelect).toHaveBeenCalledWith(shots[1]);
    expect(screen.queryByRole('button', {name: /生成画面/})).not.toBeInTheDocument();
  });
});
