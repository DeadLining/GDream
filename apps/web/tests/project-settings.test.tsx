import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ProjectSettings} from '../components/ProjectSettings';
import type {ProjectDetail,Volume} from '../lib/types';

const project:ProjectDetail={id:'p1',title:'星轨计划',logline:'寻找失落坐标',story_bible:'三卷结构',visual_style:'cinematic anime',aspect_ratio:'16:9',language:'Chinese',created_at:'',updated_at:'',characters:[],episodes:[{id:'e1',project_id:'p1',title:'启航',premise:'发现坐标',target_duration_seconds:480,status:'planned',created_at:'',updated_at:''}]};
const volumes:Volume[]=[{id:'v1',project_id:'p1',position:1,title:'启航篇',summary:'',created_at:'',updated_at:'',episodes:[{...project.episodes[0],volume_id:'v1',position:1}]}];

describe('ProjectSettings',()=>{
  afterEach(cleanup);
  it('edits project basics while preserving the approved hierarchy rules',async()=>{
    const onSave=vi.fn().mockResolvedValue(undefined);
    render(<ProjectSettings project={project} volumes={volumes} sceneCount={4} shotCount={28} onSave={onSave}/>);

    expect(screen.getByText('作品 → 卷/篇章 → 集 → 场景 → 镜头')).toBeVisible();
    expect(screen.getByText('故事线是跨集标签关系，不影响卷与剧集排序。')).toBeVisible();
    const title=screen.getByRole('textbox',{name:'作品名称'});
    await userEvent.clear(title);
    await userEvent.type(title,'星轨纪元');
    await userEvent.click(screen.getByRole('radio',{name:'9:16'}));
    await userEvent.click(screen.getByRole('button',{name:'保存设置'}));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({title:'星轨纪元',aspect_ratio:'9:16'}));
  });
});
