import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';

import {ProductionDialogueWorkspace} from '../components/production-canvas/ProductionDialogueWorkspace';
import type {Character,Shot} from '../lib/types';

const line={id:'line-1',shot_id:'shot-1',position:1,character_id:'character-1',text:'快走。',subtitle_text:'快走。',emotion:'紧张',performance_instruction:'压低声音',start_seconds:0,duration_seconds:1,audio_asset_id:null};
const shot:Shot={id:'shot-1',position:1,shot_type:'close_up',duration_seconds:3,composition:'回头示警',camera_motion:'still',character_state:{},review_status:'approved',render_status:'completed',image_prompt:'',negative_prompt:'',active_panel_asset_id:'panel-1',dialogue:[line]};
const characters:Character[]=[{id:'character-1',project_id:'project-1',name:'林默',role:'主角',appearance_bible:'',personality:'',continuity_rules:'',negative_constraints:'',voice_speaker:'林默音色',voice_instruction:'',created_at:'',updated_at:''}];

vi.mock('../components/DialogueEditor',()=>({DialogueEditor:({line,onLineUpdated}:any)=><button type="button" onClick={()=>onLineUpdated({...line,text:'更新后的对白'})}>保存测试对白</button>}));

afterEach(cleanup);

it('edits the selected dialogue inside production and returns to the canvas',async()=>{
  const user=userEvent.setup();
  const onBack=vi.fn();
  const onShotUpdated=vi.fn();
  render(<ProductionDialogueWorkspace shot={shot} characters={characters} onBackToProduction={onBack} onShotUpdated={onShotUpdated}/>);

  expect(screen.getByRole('heading',{name:'对白与配音'})).toBeVisible();
  expect(screen.getByRole('navigation',{name:'对白列表'})).toHaveTextContent('01 林默');
  await user.click(screen.getByRole('button',{name:'保存测试对白'}));
  expect(onShotUpdated).toHaveBeenCalledWith(expect.objectContaining({dialogue:[expect.objectContaining({text:'更新后的对白'})]}));
  await user.click(screen.getByRole('button',{name:'返回生产画布'}));
  expect(onBack).toHaveBeenCalledTimes(1);
});

it('shows an honest empty state for a shot without dialogue',()=>{
  render(<ProductionDialogueWorkspace shot={{...shot,dialogue:[]}} characters={characters} onBackToProduction={vi.fn()} onShotUpdated={vi.fn()}/>);
  expect(screen.getByRole('status')).toHaveTextContent('当前镜头没有对白');
});
