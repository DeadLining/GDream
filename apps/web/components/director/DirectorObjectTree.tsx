'use client';
import {Box,Plus,UserRound} from 'lucide-react';
import type {DirectorObject} from '../../lib/types';
export function DirectorObjectTree({objects,selectedId,onSelect,onAdd}:{objects:DirectorObject[];selectedId:string|null;onSelect:(id:string)=>void;onAdd:()=>void}){return <aside className="director-object-tree"><header><strong>场景对象</strong><button className="icon-button" aria-label="添加占位物" title="添加占位物" onClick={onAdd}><Plus size={16}/></button></header><div>{objects.length?objects.map(item=><button key={item.id} className={selectedId===item.id?'active':''} onClick={()=>onSelect(item.id)}>{item.kind==='character'?<UserRound size={15}/>:<Box size={15}/>}<span>{item.label}</span></button>):<p>场景中还没有对象</p>}</div></aside>}
