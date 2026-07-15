'use client';

import {ArrowLeft,AudioLines,MessageSquareText} from 'lucide-react';
import {useEffect,useMemo,useState} from 'react';

import type {Character,DialogueLine,Shot} from '../../lib/types';
import {DialogueEditor} from '../DialogueEditor';

export function ProductionDialogueWorkspace({shot,characters,onBackToProduction,onShotUpdated}:{shot:Shot;characters:Character[];onBackToProduction:()=>void;onShotUpdated:(shot:Shot)=>void}){
  const [workingShot,setWorkingShot]=useState(shot);
  const [selectedLineId,setSelectedLineId]=useState(shot.dialogue[0]?.id??null);
  useEffect(()=>{setWorkingShot(shot);setSelectedLineId(current=>shot.dialogue.some(line=>line.id===current)?current:shot.dialogue[0]?.id??null);},[shot]);
  const characterNames=useMemo(()=>new Map(characters.map(character=>[character.id,character.name])),[characters]);
  const selectedLine=workingShot.dialogue.find(line=>line.id===selectedLineId)??workingShot.dialogue[0]??null;
  const updateLine=(line:DialogueLine)=>{
    const updated={...workingShot,dialogue:workingShot.dialogue.map(item=>item.id===line.id?line:item)};
    setWorkingShot(updated);
    onShotUpdated(updated);
  };
  return <main className="production-dialogue-workspace">
    <header>
      <button type="button" aria-label="返回生产画布" onClick={onBackToProduction}><ArrowLeft size={16}/>返回生产画布</button>
      <div><span>镜头 {String(shot.position).padStart(2,'0')}</span><h1>对白与配音</h1></div>
      <small>{workingShot.dialogue.length} 条对白</small>
    </header>
    {workingShot.dialogue.length?<div className="production-dialogue-layout">
      <nav aria-label="对白列表">{workingShot.dialogue.map(line=>{
        const name=line.character_id?characterNames.get(line.character_id)??'未分配':'未分配';
        return <button key={line.id} type="button" className={line.id===selectedLine?.id?'active':''} aria-pressed={line.id===selectedLine?.id} onClick={()=>setSelectedLineId(line.id)}><MessageSquareText size={15}/><span>{String(line.position).padStart(2,'0')} {name}</span><small>{line.text||'空对白'}</small></button>;
      })}</nav>
      <section className="production-dialogue-editor"><header><div><AudioLines size={17}/><strong>对白 {String(selectedLine?.position??0).padStart(2,'0')}</strong></div><span>保存对白后可直接生成配音</span></header>{selectedLine&&<DialogueEditor line={selectedLine} characters={characters} onLineUpdated={updateLine}/>}</section>
    </div>:<section className="production-dialogue-empty" role="status"><MessageSquareText size={24}/><strong>当前镜头没有对白</strong><span>对白由剧本规划或镜头编辑流程创建。</span></section>}
  </main>;
}
