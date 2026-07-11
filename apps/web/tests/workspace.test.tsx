import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Workspace} from '../components/Workspace';
import type {EpisodeDetail, Job, Project, ProjectDetail} from '../lib/types';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(), getProject: vi.fn(), getEpisode: vi.fn(),
  createProject: vi.fn(), createEpisode: vi.fn(), startPlanning: vi.fn(),
  pollJob: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  listProjects: mocks.listProjects, getProject: mocks.getProject,
  getEpisode: mocks.getEpisode, createProject: mocks.createProject,
  createEpisode: mocks.createEpisode, startPlanning: mocks.startPlanning,
}));
vi.mock('../lib/jobs', () => ({pollJob: mocks.pollJob}));

const project: Project = {
  id: 'project-1', title: '霓虹夜行', logline: '寻找记忆', story_bible: '近未来重庆',
  visual_style: 'Chinese noir', aspect_ratio: '9:16', language: 'Chinese',
  created_at: '', updated_at: '',
};
const projectDetail: ProjectDetail = {
  ...project, characters: [], episodes: [{
    id: 'episode-1', project_id: project.id, title: '失窃的雨夜', premise: '寻找芯片',
    target_duration_seconds: 60, status: 'draft', created_at: '', updated_at: '',
  }],
};
const plannedEpisode: EpisodeDetail = {
  ...projectDetail.episodes[0], status: 'planned', scenes: [{
    id: 'scene-1', position: 1, location: '雨夜巷道', time_of_day: 'night',
    summary: '发现芯片', continuity_state: {}, estimated_duration_seconds: 10,
    shots: [{
      id: 'shot-1', position: 1, shot_type: 'wide', duration_seconds: 4,
      composition: '林默走入巷道', camera_motion: 'push_in', character_state: {},
      review_status: 'draft', render_status: 'pending', image_prompt: 'wide comic shot',
      negative_prompt: '', active_panel_asset_id: null, dialogue: [],
    }],
  }],
};
const succeededJob: Job = {
  id: 'job-1', operation: 'plan_episode', target_type: 'episode', target_id: 'episode-1',
  status: 'succeeded', progress: 100, result_metadata: {}, error: '', retry_count: 0,
  created_at: '', updated_at: '',
};

describe('Workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('loads an explicit empty state when no projects exist', async () => {
    mocks.listProjects.mockResolvedValue([]);

    render(<Workspace />);

    expect(await screen.findByRole('heading', {name: '新建第一个项目'})).toBeVisible();
    expect(screen.getByRole('button', {name: '创建项目'})).toBeEnabled();
  });

  it('loads persisted projects and plans an empty episode', async () => {
    mocks.listProjects.mockResolvedValue([project]);
    mocks.getProject.mockResolvedValue(projectDetail);
    mocks.getEpisode
      .mockResolvedValueOnce({...projectDetail.episodes[0], scenes: []})
      .mockResolvedValueOnce(plannedEpisode);
    mocks.startPlanning.mockResolvedValue(succeededJob);
    mocks.pollJob.mockResolvedValue(succeededJob);

    render(<Workspace />);

    expect(await screen.findByRole('heading', {name: '失窃的雨夜'})).toBeVisible();
    await userEvent.click(screen.getByRole('button', {name: '生成剧本与分镜'}));

    expect(await screen.findByText('场景 1')).toBeVisible();
    expect(screen.getByRole('button', {name: /镜头 1/})).toBeEnabled();
    await waitFor(() => expect(mocks.startPlanning).toHaveBeenCalledWith('episode-1'));
  });
});
