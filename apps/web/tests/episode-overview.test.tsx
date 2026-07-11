import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {EpisodeOverview} from '../components/EpisodeOverview';
import {deriveEpisodeOverview} from '../lib/episode-overview';
import type {EpisodeDetail, ProductionReadiness} from '../lib/types';

const episode: EpisodeDetail = {
  id: 'episode-1',
  project_id: 'project-1',
  title: '失窃的雨夜',
  premise: '林默在雨夜追踪一枚失窃芯片。',
  target_duration_seconds: 60,
  status: 'planned',
  created_at: '',
  updated_at: '',
  scenes: [{
    id: 'scene-1',
    position: 1,
    location: '霓虹巷道',
    time_of_day: 'night',
    summary: '林默发现交易线索。',
    continuity_state: {},
    estimated_duration_seconds: 9,
    shots: [{
      id: 'shot-1',
      position: 1,
      shot_type: 'wide',
      duration_seconds: 4,
      composition: '林默走入雨夜巷道',
      camera_motion: 'push_in',
      character_state: {},
      image_prompt: 'wide comic panel',
      negative_prompt: '',
      active_panel_asset_id: 'asset-1',
      review_status: 'approved',
      render_status: 'ready',
      dialogue: [{
        id: 'dialogue-1',
        character_id: 'character-1',
        position: 1,
        text: '芯片就在前面。',
        subtitle_text: '芯片就在前面。',
        emotion: 'focused',
        performance_instruction: '低声',
        audio_asset_id: 'audio-1',
        start_seconds: 0,
        duration_seconds: 2,
      }],
    }, {
      id: 'shot-2',
      position: 2,
      shot_type: 'close_up',
      duration_seconds: 5,
      composition: '芯片在积水中闪光',
      camera_motion: 'static',
      character_state: {},
      image_prompt: 'close-up comic panel',
      negative_prompt: '',
      active_panel_asset_id: null,
      review_status: 'draft',
      render_status: 'pending',
      dialogue: [],
    }],
  }],
};

const readiness: ProductionReadiness = {
  episode_id: episode.id,
  ready: false,
  totals: {shots: 2, dialogue: 1},
  ready_counts: {panels: 1, approved: 1, speech: 1},
  blockers: {
    missing_panels: ['shot-2'],
    unapproved_shots: ['shot-2'],
    missing_speech: [],
  },
};

describe('episode overview', () => {
  it('derives production metrics from episode shots and readiness', () => {
    expect(deriveEpisodeOverview(episode, readiness)).toEqual({
      shotCount: 2,
      dialogueCount: 1,
      durationSeconds: 9,
      panelProgress: {ready: 1, total: 2},
      speechProgress: {ready: 1, total: 1},
      reviewProgress: {ready: 1, total: 2},
      renderReady: false,
    });
  });

  it('shows progress and exact blocker counts with operational callbacks', async () => {
    const onSelectShot = vi.fn();
    const onOpenProduction = vi.fn();
    const onOpenReview = vi.fn();

    render(
      <EpisodeOverview
        episode={episode}
        readiness={readiness}
        onSelectShot={onSelectShot}
        onOpenProduction={onOpenProduction}
        onOpenReview={onOpenReview}
      />,
    );

    const identity = screen.getByRole('banner', {name: '剧集信息'});
    expect(within(identity).getByText('第 01 集')).toBeVisible();
    expect(within(identity).getByText('已规划')).toBeVisible();
    expect(within(identity).getByText('目标 60 秒')).toBeVisible();
    expect(within(identity).getByRole('heading', {name: episode.title})).toBeVisible();
    expect(within(identity).getByText(episode.premise)).toBeVisible();
    expect(screen.getByText('2 个镜头')).toBeVisible();
    expect(screen.getByText('1 条对白')).toBeVisible();
    expect(screen.getByText('9 秒')).toBeVisible();
    expect(screen.getAllByTestId('overview-metric')).toHaveLength(3);
    expect(screen.getByRole('progressbar', {name: '画面进度'})).toHaveAttribute('value', '1');
    expect(screen.getByRole('progressbar', {name: '画面进度'})).toHaveAttribute('max', '2');
    expect(screen.getByText('缺少画面 1')).toBeVisible();
    expect(screen.getByText('未审核镜头 1')).toBeVisible();
    expect(screen.getByText('缺少配音 0')).toBeVisible();
    expect(screen.getByRole('region', {name: '镜头墙'})).toBeVisible();

    await userEvent.click(screen.getByRole('button', {name: /镜头 2/}));
    expect(onSelectShot).toHaveBeenCalledWith('shot-2');

    await userEvent.click(screen.getByRole('button', {name: '打开生产'}));
    expect(onOpenProduction).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', {name: '处理阻塞项'}));
    expect(onOpenReview).toHaveBeenCalledOnce();
  });

  it('shows truthful empty metrics without exposing a contradictory progress range', () => {
    const emptyEpisode: EpisodeDetail = {...episode, scenes: []};
    const emptyReadiness: ProductionReadiness = {
      episode_id: episode.id,
      ready: false,
      totals: {shots: 0, dialogue: 0},
      ready_counts: {panels: 0, approved: 0, speech: 0},
      blockers: {missing_panels: [], unapproved_shots: [], missing_speech: []},
    };

    const {container} = render(
      <EpisodeOverview
        episode={emptyEpisode}
        readiness={emptyReadiness}
        onSelectShot={vi.fn()}
        onOpenProduction={vi.fn()}
        onOpenReview={vi.fn()}
      />,
    );

    expect(within(container).getAllByText('0 / 0')).toHaveLength(3);
    expect(within(container).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(container).getByLabelText('画面进度：无项目')).toHaveTextContent('暂无项目');
  });
});
