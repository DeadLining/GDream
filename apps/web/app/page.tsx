import {Workspace} from '../components/Workspace';
import type {EpisodeDetail} from '../lib/types';

const demoEpisode: EpisodeDetail = {
  id: 'demo-episode', project_id: 'demo-project', title: '失窃的雨夜',
  premise: '林默在暴雨中追查一段不属于死者的记忆。', target_duration_seconds: 60, status: 'planned',
  scenes: [
    {id: 'scene-1', position: 1, location: '下城 · 记忆交易巷', time_of_day: 'night', summary: '林默循着异常信号进入封锁区。', estimated_duration_seconds: 22,
      shots: [
        {id: 'shot-1', position: 1, shot_type: 'establishing', duration_seconds: 4, composition: '暴雨笼罩的下城巷道，林默背对镜头走入红色霓虹。', camera_motion: 'push_in', review_status: 'approved', image_prompt: 'Vertical Chinese noir comic establishing shot, rain-soaked Chongqing alley, lone detective in black coat, cyan and red neon, cinematic ink texture', active_panel_asset_id: 'demo-panel', dialogue: []},
        {id: 'shot-2', position: 2, shot_type: 'close_up', duration_seconds: 5, composition: '银色左眼映出一枚损坏的记忆芯片。', camera_motion: 'push_in', review_status: 'draft', image_prompt: 'Extreme close-up of a Chinese detective silver cybernetic left eye reflecting a damaged memory chip, noir comic', active_panel_asset_id: null, dialogue: [{id: 'line-1', text: '这段记忆，不属于死者。'}]},
        {id: 'shot-3', position: 3, shot_type: 'over_shoulder', duration_seconds: 6, composition: '陌生女孩出现在林默身后的积水倒影里。', camera_motion: 'pan_left', review_status: 'draft', image_prompt: 'Over-shoulder comic shot, mysterious young woman appears only in rain puddle reflection behind detective', active_panel_asset_id: null, dialogue: []},
      ]},
    {id: 'scene-2', position: 2, location: '废弃记忆诊所', time_of_day: 'night', summary: '芯片播放出被人为删除的最后十秒。', estimated_duration_seconds: 18,
      shots: [
        {id: 'shot-4', position: 4, shot_type: 'medium', duration_seconds: 5, composition: '林默将芯片插入老式读取器，诊所瞬间断电。', camera_motion: 'pull_out', review_status: 'draft', image_prompt: 'Medium comic shot in abandoned memory clinic, detective inserts glowing chip into retro machine, sudden blackout', active_panel_asset_id: null, dialogue: []},
        {id: 'shot-5', position: 5, shot_type: 'insert', duration_seconds: 4, composition: '屏幕只显示一行警告：你已经看过这段记忆。', camera_motion: 'still', review_status: 'draft', image_prompt: 'Insert shot of retro terminal in darkness, ominous interface glow, no readable text', active_panel_asset_id: null, dialogue: []},
      ]},
  ],
};

export default function Home() { return <Workspace initialEpisode={demoEpisode} />; }
