import type {Project} from './types';

const RECENT_PROJECTS_KEY='ai-comic-recent-projects';
const MAX_STORED_PROJECTS=20;

const readProjectIds=():string[]=>{
  if(typeof window==='undefined')return [];
  try{
    const value=JSON.parse(window.localStorage.getItem(RECENT_PROJECTS_KEY)??'[]');
    return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];
  }catch{return [];}
};

export const markProjectAccess=(projectId:string)=>{
  if(typeof window==='undefined'||!projectId)return;
  const ids=[projectId,...readProjectIds().filter(id=>id!==projectId)].slice(0,MAX_STORED_PROJECTS);
  window.localStorage.setItem(RECENT_PROJECTS_KEY,JSON.stringify(ids));
};

export const orderRecentlyAccessedProjects=(projects:Project[],limit=5):Project[]=>{
  const byId=new Map(projects.map(project=>[project.id,project]));
  const accessed=readProjectIds().flatMap(id=>{
    const project=byId.get(id);
    if(!project)return [];
    byId.delete(id);
    return [project];
  });
  const remaining=[...byId.values()].sort((left,right)=>Date.parse(right.updated_at)-Date.parse(left.updated_at));
  return [...accessed,...remaining].slice(0,limit);
};
