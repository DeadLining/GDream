import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {StorylineCanvas} from '../components/canvas/StorylineCanvas';

const volumes=[{id:'v1',project_id:'p1',position:1,title:'第一卷',summary:'',created_at:'',updated_at:'',episodes:[{id:'e1',project_id:'p1',volume_id:'v1',position:1,title:'第一集',premise:'',target_duration_seconds:60,status:'planned',created_at:'',updated_at:''},{id:'e3',project_id:'p1',volume_id:'v1',position:3,title:'第三集',premise:'',target_duration_seconds:60,status:'planned',created_at:'',updated_at:''}]}];
const storylines=[{id:'l1',project_id:'p1',title:'时间裂缝',kind:'foreshadowing' as const,color:'#B9473E',description:'',created_at:'',updated_at:'',events:[{id:'ev1',storyline_id:'l1',episode_id:'e1',scene_id:null,shot_id:null,position:1,stage:'setup' as const,title:'金属海螺异动',description:'首次异常',setup_event_id:null,payoff_event_id:'ev3',metadata:{},created_at:'',updated_at:''},{id:'ev3',storyline_id:'l1',episode_id:'e3',scene_id:null,shot_id:null,position:2,stage:'development' as const,title:'首次稳定裂缝',description:'威胁升级',setup_event_id:'ev1',payoff_event_id:null,metadata:{},created_at:'',updated_at:''}]}];

describe('StorylineCanvas', () => {
  afterEach(cleanup);

  it('keeps volume ordering while selecting a cross-episode event', async () => {
    render(<StorylineCanvas scriptTitle="穿越时空" volumes={volumes} storylines={storylines}/>);
    expect(screen.getByText('第一卷')).toBeVisible();

    await userEvent.click(screen.getByRole('button', {name: '首次稳定裂缝'}));

    expect(screen.getByRole('heading', {name: '首次稳定裂缝'})).toBeVisible();
    expect(screen.getByText('铺垫：金属海螺异动')).toBeVisible();
  });

  it('renders storyline events for episodes that are not assigned to a volume', () => {
    const episode={id:'e1',project_id:'p1',volume_id:null,position:1,title:'第一集',premise:'',target_duration_seconds:60,status:'planned',created_at:'',updated_at:''};

    render(<StorylineCanvas scriptTitle="穿越时空" volumes={[]} unassignedEpisodes={[episode]} storylines={storylines}/>);

    expect(screen.getByText('未分卷')).toBeVisible();
    expect(screen.getByRole('button',{name:'金属海螺异动'})).toBeVisible();
  });

  it('creates a storyline and a cross-episode event from the canvas', async () => {
    const onCreateStoryline=vi.fn().mockResolvedValue(undefined);
    const onCreateEvent=vi.fn().mockResolvedValue(undefined);
    render(<StorylineCanvas scriptTitle="穿越时空" volumes={volumes} storylines={storylines} onCreateStoryline={onCreateStoryline} onCreateEvent={onCreateEvent}/>);

    await userEvent.click(screen.getByRole('button',{name:'新建故事线'}));
    await userEvent.type(screen.getByRole('textbox',{name:'故事线标题'}),'林默成长');
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'故事线类型'}),'character_arc');
    await userEvent.click(screen.getByRole('button',{name:'保存故事线'}));
    expect(onCreateStoryline).toHaveBeenCalledWith(expect.objectContaining({title:'林默成长',kind:'character_arc'}));

    await userEvent.click(screen.getByRole('button',{name:'新建事件'}));
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'关联剧集'}),'e3');
    await userEvent.type(screen.getByRole('textbox',{name:'事件标题'}),'林默主动进入裂缝');
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'事件阶段'}),'payoff');
    await userEvent.click(screen.getByRole('button',{name:'保存事件'}));
    expect(onCreateEvent).toHaveBeenCalledWith('l1',expect.objectContaining({episode_id:'e3',title:'林默主动进入裂缝',stage:'payoff'}));
  });

  it('edits the selected storyline and event, then deletes the event', async () => {
    const onUpdateStoryline=vi.fn().mockResolvedValue(undefined);
    const onUpdateEvent=vi.fn().mockResolvedValue(undefined);
    const onDeleteEvent=vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window,'confirm').mockReturnValue(true);
    render(<StorylineCanvas scriptTitle="穿越时空" volumes={volumes} storylines={storylines} onUpdateStoryline={onUpdateStoryline} onUpdateEvent={onUpdateEvent} onDeleteEvent={onDeleteEvent}/>);

    await userEvent.click(screen.getByRole('button',{name:'编辑故事线 时间裂缝'}));
    const lineTitle=screen.getByRole('textbox',{name:'故事线标题'});
    await userEvent.clear(lineTitle);
    await userEvent.type(lineTitle,'裂缝真相');
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'故事线类型'}),'mystery');
    await userEvent.click(screen.getByRole('button',{name:'保存故事线'}));
    expect(onUpdateStoryline).toHaveBeenCalledWith('l1',expect.objectContaining({title:'裂缝真相',kind:'mystery'}));

    await userEvent.click(screen.getByRole('button',{name:'首次稳定裂缝'}));
    await userEvent.click(screen.getByRole('button',{name:'编辑事件'}));
    const eventTitle=screen.getByRole('textbox',{name:'事件标题'});
    await userEvent.clear(eventTitle);
    await userEvent.type(eventTitle,'裂缝坐标确认');
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'事件阶段'}),'escalation');
    await userEvent.click(screen.getByRole('button',{name:'保存事件'}));
    expect(onUpdateEvent).toHaveBeenCalledWith('ev3',expect.objectContaining({title:'裂缝坐标确认',stage:'escalation'}));

    await userEvent.click(screen.getByRole('button',{name:'删除事件'}));
    expect(window.confirm).toHaveBeenCalledWith('删除故事线事件“首次稳定裂缝”？');
    expect(onDeleteEvent).toHaveBeenCalledWith('ev3');
  });
});
