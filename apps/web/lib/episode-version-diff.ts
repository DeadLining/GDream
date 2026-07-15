export type EpisodeVersionDiffScope='episode'|'scene'|'shot'|'dialogue';
export type EpisodeVersionChangeType='added'|'removed'|'changed'|'moved';
export type EpisodeVersionDiffField={key:string;label:string;before:unknown;after:unknown};
export type EpisodeVersionChange={scope:EpisodeVersionDiffScope;change_type:EpisodeVersionChangeType;id:string;label:string;fields:EpisodeVersionDiffField[]};
export type EpisodeVersionDiff={summary:{total:number;added:number;removed:number;changed:number;moved:number};changes:EpisodeVersionChange[]};

type JsonRecord=Record<string,unknown>;
type IndexedEntity={item:JsonRecord;parentId:string|null};
type FieldDefinition=[key:string,label:string];

const episodeFields:FieldDefinition[]=[['volume_id','所属卷'],['position','集序'],['title','标题'],['premise','故事梗概'],['target_duration_seconds','目标时长'],['status','制作状态']];
const sceneFields:FieldDefinition[]=[['position','场景序号'],['location','地点'],['time_of_day','时间'],['summary','场景摘要'],['continuity_state','连续性状态'],['estimated_duration_seconds','预计时长']];
const shotFields:FieldDefinition[]=[['scene_id','所属场景'],['position','镜头序号'],['shot_type','景别'],['duration_seconds','镜头时长'],['composition','构图'],['camera_motion','运镜'],['character_state','角色状态'],['image_prompt','画面提示词'],['negative_prompt','画面负面词'],['active_panel_asset_id','当前画面'],['previous_shot_tail_asset_id','前镜尾帧'],['video_prompt','视频提示词'],['negative_video_prompt','视频负面词'],['active_video_asset_id','当前视频'],['video_render_status','视频状态'],['review_status','审核状态'],['render_status','画面状态']];
const dialogueFields:FieldDefinition[]=[['shot_id','所属镜头'],['position','对白序号'],['character_id','角色'],['text','对白'],['subtitle_text','字幕'],['emotion','情绪'],['performance_instruction','表演指令'],['audio_asset_id','语音资产'],['start_seconds','开始时间'],['duration_seconds','持续时间']];

const asRecord=(value:unknown):JsonRecord=>typeof value==='object'&&value!==null&&!Array.isArray(value)?value as JsonRecord:{};
const asArray=(value:unknown):JsonRecord[]=>Array.isArray(value)?value.map(asRecord):[];
const entityId=(item:JsonRecord)=>typeof item.id==='string'?item.id:'';
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):typeof value==='object'&&value!==null?Object.fromEntries(Object.entries(value as JsonRecord).sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>[key,canonical(item)])):value;
const equal=(left:unknown,right:unknown)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
const number=(value:unknown)=>typeof value==='number'?value:null;
const short=(value:string,max=32)=>value.length>max?`${value.slice(0,max)}…`:value;

const indexSnapshots=(snapshot:Record<string,unknown>)=>{
  const episode=asRecord(snapshot.episode);
  const scenes=new Map<string,IndexedEntity>();
  const shots=new Map<string,IndexedEntity>();
  const dialogue=new Map<string,IndexedEntity>();
  for(const scene of asArray(snapshot.scenes)){
    const sceneId=entityId(scene);if(!sceneId)continue;
    scenes.set(sceneId,{item:scene,parentId:entityId(episode)||null});
    for(const shot of asArray(scene.shots)){
      const shotId=entityId(shot);if(!shotId)continue;
      shots.set(shotId,{item:{...shot,scene_id:sceneId},parentId:sceneId});
      for(const line of asArray(shot.dialogue)){
        const lineId=entityId(line);if(!lineId)continue;
        dialogue.set(lineId,{item:{...line,shot_id:shotId},parentId:shotId});
      }
    }
  }
  return {episode,scenes,shots,dialogue};
};

const changedFields=(before:JsonRecord,after:JsonRecord,definitions:FieldDefinition[])=>definitions.flatMap(([key,label])=>{const previous=before[key]??null;const current=after[key]??null;return equal(previous,current)?[]:[{key,label,before:previous,after:current}];});
const labelFor=(scope:EpisodeVersionDiffScope,item:JsonRecord)=>{
  if(scope==='episode')return text(item.title)||'当前单集';
  if(scope==='scene')return text(item.location)||`场景 ${number(item.position)??'-'}`;
  if(scope==='shot')return text(item.composition)||`镜头 ${number(item.position)??'-'}`;
  return short(text(item.text)||`对白 ${number(item.position)??'-'}`);
};

function compareEntities(scope:Exclude<EpisodeVersionDiffScope,'episode'>,before:Map<string,IndexedEntity>,after:Map<string,IndexedEntity>,definitions:FieldDefinition[]):EpisodeVersionChange[]{
  const changes:EpisodeVersionChange[]=[];
  const ids=new Set([...before.keys(),...after.keys()]);
  for(const id of ids){
    const previous=before.get(id);const current=after.get(id);
    if(!previous&&current){changes.push({scope,change_type:'added',id,label:labelFor(scope,current.item),fields:[]});continue;}
    if(previous&&!current){changes.push({scope,change_type:'removed',id,label:labelFor(scope,previous.item),fields:[]});continue;}
    if(!previous||!current)continue;
    const fields=changedFields(previous.item,current.item,definitions);
    if(!fields.length)continue;
    const moved=previous.parentId!==current.parentId||!equal(previous.item.position,current.item.position);
    changes.push({scope,change_type:moved?'moved':'changed',id,label:labelFor(scope,current.item),fields});
  }
  return changes;
}

export function diffEpisodeSnapshots(beforeSnapshot:Record<string,unknown>,afterSnapshot:Record<string,unknown>):EpisodeVersionDiff{
  const before=indexSnapshots(beforeSnapshot);const after=indexSnapshots(afterSnapshot);
  const changes:EpisodeVersionChange[]=[];
  const episodeFieldsChanged=changedFields(before.episode,after.episode,episodeFields);
  const episodeId=entityId(after.episode)||entityId(before.episode);
  if(episodeFieldsChanged.length)changes.push({scope:'episode',change_type:'changed',id:episodeId,label:labelFor('episode',after.episode),fields:episodeFieldsChanged});
  changes.push(...compareEntities('scene',before.scenes,after.scenes,sceneFields));
  changes.push(...compareEntities('shot',before.shots,after.shots,shotFields));
  changes.push(...compareEntities('dialogue',before.dialogue,after.dialogue,dialogueFields));
  const summary={total:changes.length,added:0,removed:0,changed:0,moved:0};
  for(const change of changes)summary[change.change_type]+=1;
  return {summary,changes};
}
