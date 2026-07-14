import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ProductOverview} from '../components/ProductOverview';
import type {EpisodeDetail, ProductionReadiness, ProjectDetail, Storyline, Volume} from '../lib/types';

const project: ProjectDetail = {
  id: 'project-1', title: '时空漫游', logline: '寻找失落的时间线', story_bible: '跨越三卷的成长故事', visual_style: 'cinematic anime', aspect_ratio: '16:9', language: 'Chinese', created_at: '', updated_at: '',
  characters: [{id: 'char-1', project_id: 'project-1', name: '林默', role: 'protagonist', appearance_bible: '', personality: '', continuity_rules: '', negative_constraints: '', voice_speaker: '', voice_instruction: '', created_at: '', updated_at: ''}],
  episodes: [{id: 'episode-1', project_id: 'project-1', title: '穿越时空', premise: '发现裂缝', target_duration_seconds: 60, status: 'planned', created_at: '', updated_at: ''}],
};
const episode: EpisodeDetail = {...project.episodes[0], scenes: [{id: 'scene-1', position: 1, location: '实验室', time_of_day: 'night', summary: '', continuity_state: {}, estimated_duration_seconds: 30, shots: []}]};
const readiness: ProductionReadiness = {episode_id: 'episode-1', ready: false, totals: {shots: 4, dialogue: 2}, ready_counts: {panels: 2, approved: 1, speech: 1}, blockers: {missing_panels: ['a','b'], unapproved_shots: ['a'], missing_speech: ['d']}};
const volumes: Volume[] = [{id:'volume-1',project_id:'project-1',position:1,title:'裂缝初现',summary:'第一卷',created_at:'',updated_at:'',episodes:[{...project.episodes[0],volume_id:'volume-1',position:1}]}];
const storylines: Storyline[] = [{id:'line-1',project_id:'project-1',title:'怀表来源',kind:'foreshadowing',color:'#B9473E',description:'跨集伏笔',created_at:'',updated_at:'',events:[]}];

describe('ProductOverview', () => {
  afterEach(cleanup);

  it('summarizes the work and enters its primary episode workflow', async () => {
    const onOpenEpisode = vi.fn();
    render(<ProductOverview project={project} episode={episode} readiness={readiness} volumes={volumes} storylines={storylines} onOpenEpisode={onOpenEpisode} onOpenScript={vi.fn()} onOpenAssets={vi.fn()}/>);

    expect(screen.getByRole('heading', {name: '时空漫游'})).toBeVisible();
    expect(screen.getByText('裂缝初现')).toBeVisible();
    expect(screen.getByText('怀表来源')).toBeVisible();
    expect(screen.getByText('资产准备')).toBeVisible();

    await userEvent.click(screen.getByRole('button', {name: '进入第 01 集制作'}));
    expect(onOpenEpisode).toHaveBeenCalledWith('episode-1');
  });

  it('keeps unassigned episodes visible and opens the selected episode from the primary action', async () => {
    const unassigned = {...project.episodes[0], id: 'episode-2', title: '未归卷第二集'};
    const multiEpisodeProject = {...project, episodes: [project.episodes[0], unassigned]};
    const selectedEpisode: EpisodeDetail = {...unassigned, scenes: []};
    const onOpenEpisode = vi.fn();

    render(<ProductOverview project={multiEpisodeProject} episode={selectedEpisode} readiness={null} volumes={volumes} storylines={storylines} onOpenEpisode={onOpenEpisode} onOpenScript={vi.fn()} onOpenAssets={vi.fn()}/>);

    expect(screen.getByText('未归卷第二集')).toBeVisible();
    await userEvent.click(screen.getByRole('button', {name: '进入制作'}));
    expect(onOpenEpisode).toHaveBeenCalledWith('episode-2');
  });

  it('creates the next volume from the work overview', async () => {
    const onCreateVolume = vi.fn().mockResolvedValue(undefined);
    render(<ProductOverview project={project} episode={episode} readiness={readiness} volumes={volumes} storylines={storylines} onOpenEpisode={vi.fn()} onOpenScript={vi.fn()} onOpenAssets={vi.fn()} onCreateVolume={onCreateVolume}/>);

    await userEvent.click(screen.getByRole('button', {name: '新建卷'}));
    await userEvent.type(screen.getByRole('textbox', {name: '卷标题'}), '迷雾深处');
    await userEvent.type(screen.getByRole('textbox', {name: '卷简介'}), '主角进入裂缝后的新篇章');
    await userEvent.click(screen.getByRole('button', {name: '保存卷'}));

    expect(onCreateVolume).toHaveBeenCalledWith({
      title: '迷雾深处',
      summary: '主角进入裂缝后的新篇章',
      position: 2,
    });
  });

  it('edits a volume title, summary, and stable position', async () => {
    const onUpdateVolume = vi.fn().mockResolvedValue(undefined);
    render(<ProductOverview project={project} episode={episode} readiness={readiness} volumes={volumes} storylines={storylines} onOpenEpisode={vi.fn()} onOpenScript={vi.fn()} onOpenAssets={vi.fn()} onUpdateVolume={onUpdateVolume}/>);

    await userEvent.click(screen.getByRole('button', {name: '编辑卷 裂缝初现'}));
    const title=screen.getByRole('textbox',{name:'卷标题'});
    await userEvent.clear(title);
    await userEvent.type(title,'裂缝觉醒');
    const summary=screen.getByRole('textbox',{name:'卷简介'});
    await userEvent.clear(summary);
    await userEvent.type(summary,'稳定排序后的第一篇章');
    const position=screen.getByRole('spinbutton',{name:'卷排序'});
    await userEvent.clear(position);
    await userEvent.type(position,'2');
    await userEvent.click(screen.getByRole('button',{name:'保存卷'}));

    expect(onUpdateVolume).toHaveBeenCalledWith('volume-1',{
      title:'裂缝觉醒',summary:'稳定排序后的第一篇章',position:2,
    });
  });

  it('renders every volume separately and moves episodes across volume boundaries', async () => {
    const secondEpisode = {...project.episodes[0], id:'episode-2', title:'深入裂缝', volume_id:'volume-2', position:1};
    const unassignedEpisode = {...project.episodes[0], id:'episode-3', title:'卷外余波', volume_id:null, position:1};
    const multiVolumeProject = {...project, episodes:[project.episodes[0], secondEpisode, unassignedEpisode]};
    const multiVolumes:Volume[] = [
      volumes[0],
      {id:'volume-2',project_id:'project-1',position:2,title:'迷雾深处',summary:'第二卷',created_at:'',updated_at:'',episodes:[secondEpisode]},
    ];
    const onMoveEpisode = vi.fn().mockResolvedValue(undefined);

    render(<ProductOverview project={multiVolumeProject} episode={episode} readiness={readiness} volumes={multiVolumes} storylines={storylines} onOpenEpisode={vi.fn()} onOpenScript={vi.fn()} onOpenAssets={vi.fn()} onMoveEpisode={onMoveEpisode}/>);

    expect(screen.getByRole('heading',{name:'裂缝初现'})).toBeVisible();
    expect(screen.getByRole('heading',{name:'迷雾深处'})).toBeVisible();
    expect(screen.getByRole('heading',{name:'未归卷剧集'})).toBeVisible();
    expect(screen.getByText('深入裂缝')).toBeVisible();
    expect(screen.getByText('卷外余波')).toBeVisible();

    await userEvent.selectOptions(screen.getByRole('combobox',{name:'剧集 深入裂缝 所属卷'}),'volume-1');
    expect(onMoveEpisode).toHaveBeenCalledWith('episode-2','volume-1');
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'剧集 卷外余波 所属卷'}),'volume-2');
    expect(onMoveEpisode).toHaveBeenCalledWith('episode-3','volume-2');
  });

  it('edits and deletes any selected volume', async () => {
    const secondVolume:Volume = {id:'volume-2',project_id:'project-1',position:2,title:'迷雾深处',summary:'第二卷',created_at:'',updated_at:'',episodes:[]};
    const onUpdateVolume=vi.fn().mockResolvedValue(undefined);
    const onDeleteVolume=vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window,'confirm').mockReturnValue(true);

    render(<ProductOverview project={project} episode={episode} readiness={readiness} volumes={[...volumes,secondVolume]} storylines={storylines} onOpenEpisode={vi.fn()} onOpenScript={vi.fn()} onOpenAssets={vi.fn()} onUpdateVolume={onUpdateVolume} onDeleteVolume={onDeleteVolume}/>);

    await userEvent.click(screen.getByRole('button',{name:'编辑卷 迷雾深处'}));
    expect(screen.getByRole('textbox',{name:'卷标题'})).toHaveValue('迷雾深处');
    await userEvent.click(screen.getByRole('button',{name:'关闭卷表单'}));
    await userEvent.click(screen.getByRole('button',{name:'删除卷 迷雾深处'}));
    expect(onDeleteVolume).toHaveBeenCalledWith('volume-2');
  });
});
