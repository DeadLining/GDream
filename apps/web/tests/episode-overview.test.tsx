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
        episodeNumber={1}
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

  it('shows a truthful ready state without blocker language or actions', async () => {
    const onOpenProduction = vi.fn();
    const readyReadiness: ProductionReadiness = {
      ...readiness,
      ready: true,
      ready_counts: {panels: 2, approved: 2, speech: 1},
      blockers: {missing_panels: [], unapproved_shots: [], missing_speech: []},
    };

    const {container} = render(
      <EpisodeOverview
        episode={episode}
        episodeNumber={1}
        readiness={readyReadiness}
        onSelectShot={vi.fn()}
        onOpenProduction={onOpenProduction}
        onOpenReview={vi.fn()}
      />,
    );

    const view = within(container);
    expect(view.getByText('可渲染')).toBeVisible();
    const readyHeading = view.getByRole('heading', {name: '素材已就绪'});
    const readyStrip = readyHeading.closest('section')!;
    expect(within(readyStrip).getByRole('heading', {name: '素材已就绪'})).toBeVisible();
    expect(view.queryByRole('heading', {name: '渲染阻塞'})).not.toBeInTheDocument();
    expect(within(readyStrip).queryByText(/缺少画面|未审核镜头|缺少配音/)).not.toBeInTheDocument();
    expect(view.queryByRole('button', {name: '处理阻塞项'})).not.toBeInTheDocument();

    await userEvent.click(view.getByRole('button', {name: '打开生产'}));
    expect(onOpenProduction).toHaveBeenCalledOnce();
  });

  it('uses final video readiness and shows missing and stale video blockers', () => {
    const videoBlockedReadiness: ProductionReadiness = {
      ...readiness,
      ready: true,
      video_ready: false,
      blockers: {
        ...readiness.blockers,
        missing_videos: ['shot-2'],
        stale_videos: ['shot-1'],
      },
    };
    expect(deriveEpisodeOverview(episode, videoBlockedReadiness).renderReady).toBe(false);
    const {container} = render(
      <EpisodeOverview
        episode={episode}
        episodeNumber={1}
        readiness={videoBlockedReadiness}
        onSelectShot={vi.fn()}
        onOpenProduction={vi.fn()}
        onOpenReview={vi.fn()}
      />,
    );

    const view = within(container);
    expect(view.getByText('尚未就绪')).toBeVisible();
    expect(view.getByText('缺少视频 1')).toBeVisible();
    expect(view.getByText('过期视频 1')).toBeVisible();
  });

  it('uses an explicit episode number instead of deriving one from an opaque id', () => {
    const uuidEpisode = {...episode, id: '550e8400-e29b-41d4-a716-44665544abcd'};

    render(
      <EpisodeOverview
        episode={uuidEpisode}
        episodeNumber={12}
        readiness={{...readiness, episode_id: uuidEpisode.id}}
        onSelectShot={vi.fn()}
        onOpenProduction={vi.fn()}
        onOpenReview={vi.fn()}
      />,
    );

    expect(screen.getByText('第 12 集')).toBeVisible();
  });

  it('shows a neutral episode label when no ordered position is available', () => {
    const uuidEpisode = {...episode, id: '550e8400-e29b-41d4-a716-44665544abcd'};

    const {container} = render(
      <EpisodeOverview
        episode={uuidEpisode}
        readiness={{...readiness, episode_id: uuidEpisode.id}}
        onSelectShot={vi.fn()}
        onOpenProduction={vi.fn()}
        onOpenReview={vi.fn()}
      />,
    );

    const identity = within(container).getByRole('banner', {name: '剧集信息'});
    expect(within(identity).getByText('剧集')).toBeVisible();
    expect(within(identity).queryByText(/第 \d+ 集/)).not.toBeInTheDocument();
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
