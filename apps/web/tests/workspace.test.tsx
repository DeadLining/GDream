import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {Workspace} from '../components/Workspace';
import type {EpisodeDetail} from '../lib/types';

const fixtureEpisode: EpisodeDetail = {
  id: 'episode-1',
  project_id: 'project-1',
  title: '失窃的雨夜',
  premise: '林默追查一段被盗记忆',
  target_duration_seconds: 60,
  status: 'planned',
  scenes: [
    {
      id: 'scene-1', position: 1, location: '雨夜巷道', summary: '发现芯片',
      time_of_day: 'night', estimated_duration_seconds: 10,
      shots: [
        {id: 'shot-1', position: 1, shot_type: 'wide', duration_seconds: 4,
          composition: '林默走入巷道', camera_motion: 'push_in', review_status: 'approved',
          image_prompt: 'wide comic shot', active_panel_asset_id: 'asset-1', dialogue: []},
        {id: 'shot-2', position: 2, shot_type: 'close_up', duration_seconds: 5,
          composition: '银色左眼映出芯片', camera_motion: 'push_in', review_status: 'draft',
          image_prompt: 'close-up comic shot', active_panel_asset_id: null, dialogue: []},
      ],
    },
  ],
};

describe('Workspace', () => {
  it('selects a shot and exposes generation controls in the inspector', async () => {
    render(<Workspace initialEpisode={fixtureEpisode} />);
    await userEvent.click(screen.getByRole('button', {name: /镜头 2/}));

    expect(screen.getByRole('heading', {name: '镜头 2'})).toBeVisible();
    expect(screen.getByRole('button', {name: '生成画面'})).toBeEnabled();
  });
});
