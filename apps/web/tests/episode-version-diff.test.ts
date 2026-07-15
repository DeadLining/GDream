import {describe,expect,it} from 'vitest';
import {diffEpisodeSnapshots} from '../lib/episode-version-diff';

const before={
  episode:{id:'e1',project_id:'p1',title:'审核前标题',premise:'旧梗概',target_duration_seconds:60,status:'planned'},
  scenes:[{id:'s1',position:1,location:'雨夜巷道',time_of_day:'night',summary:'追踪',continuity_state:{},estimated_duration_seconds:20,shots:[
    {id:'shot-1',position:1,shot_type:'wide',duration_seconds:4,composition:'旧构图',camera_motion:'static',character_state:{},image_prompt:'old',negative_prompt:'',active_panel_asset_id:'panel-1',previous_shot_tail_asset_id:null,video_prompt:'',negative_video_prompt:'',active_video_asset_id:null,video_render_status:'pending',review_status:'draft',render_status:'pending',dialogue:[
      {id:'line-1',position:1,character_id:'c1',text:'旧对白',subtitle_text:'旧对白',emotion:'neutral',performance_instruction:'',audio_asset_id:null,start_seconds:0,duration_seconds:1},
      {id:'line-2',position:2,character_id:'c1',text:'被删除对白',subtitle_text:'被删除对白',emotion:'neutral',performance_instruction:'',audio_asset_id:null,start_seconds:1,duration_seconds:1},
    ]},
    {id:'shot-2',position:2,shot_type:'close_up',duration_seconds:3,composition:'移动镜头',camera_motion:'static',character_state:{},image_prompt:'',negative_prompt:'',dialogue:[]},
    {id:'shot-3',position:3,shot_type:'medium',duration_seconds:3,composition:'删除镜头',camera_motion:'static',character_state:{},image_prompt:'',negative_prompt:'',dialogue:[]},
  ]}],
};
const after={
  episode:{...before.episode,title:'当前标题',status:'production'},
  scenes:[
    {id:'s1',position:1,location:'天台',time_of_day:'night',summary:'追踪',continuity_state:{},estimated_duration_seconds:20,shots:[
      {...before.scenes[0].shots[0],position:2,composition:'新构图',active_panel_asset_id:'panel-2',review_status:'approved',dialogue:[{...before.scenes[0].shots[0].dialogue[0],text:'新对白',subtitle_text:'新对白',audio_asset_id:'audio-1'}]},
    ]},
    {id:'s2',position:2,location:'地铁站',time_of_day:'day',summary:'新增场景',continuity_state:{},estimated_duration_seconds:15,shots:[
      {...before.scenes[0].shots[1],position:1},
    ]},
  ],
};

describe('episode version diff',()=>{
  it('classifies hierarchical additions, removals, moves, and field changes',()=>{
    const result=diffEpisodeSnapshots(before,after);
    expect(result.summary).toEqual({total:8,added:1,removed:2,changed:3,moved:2});
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({scope:'episode',change_type:'changed',id:'e1',fields:expect.arrayContaining([expect.objectContaining({key:'title',before:'审核前标题',after:'当前标题'})])}),
      expect.objectContaining({scope:'scene',change_type:'added',id:'s2',label:'地铁站'}),
      expect.objectContaining({scope:'shot',change_type:'moved',id:'shot-2',fields:expect.arrayContaining([expect.objectContaining({key:'scene_id',before:'s1',after:'s2'})])}),
      expect.objectContaining({scope:'shot',change_type:'removed',id:'shot-3'}),
      expect.objectContaining({scope:'dialogue',change_type:'changed',id:'line-1',fields:expect.arrayContaining([expect.objectContaining({key:'audio_asset_id',before:null,after:'audio-1'})])}),
      expect.objectContaining({scope:'dialogue',change_type:'removed',id:'line-2'}),
    ]));
  });

  it('returns an empty diff for equivalent snapshots',()=>{
    expect(diffEpisodeSnapshots(before,structuredClone(before))).toEqual({summary:{total:0,added:0,removed:0,changed:0,moved:0},changes:[]});
  });

  it('treats omitted optional references and explicit null as equivalent',()=>{
    const legacy={episode:{id:'e1',project_id:'p1',title:'标题',premise:'',target_duration_seconds:60,status:'draft'},scenes:[{id:'s1',position:1,location:'巷道',time_of_day:'night',summary:'',continuity_state:{},estimated_duration_seconds:10,shots:[{id:'shot-1',position:1,shot_type:'wide',duration_seconds:3,composition:'',camera_motion:'static',character_state:{},image_prompt:'',negative_prompt:'',dialogue:[]}]}]};
    const current=structuredClone(legacy) as typeof legacy&{scenes:Array<{shots:Array<Record<string,unknown>>}>};
    Object.assign(current.scenes[0].shots[0],{active_panel_asset_id:null,previous_shot_tail_asset_id:null,active_video_asset_id:null});
    expect(diffEpisodeSnapshots(legacy,current).summary.total).toBe(0);
  });
});
