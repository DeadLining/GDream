import {BookOpen,Clapperboard,FileText,Plus,Trash2,Users} from 'lucide-react';
import type {Project, ProjectDetail} from '../lib/types';

export function ProjectNavigator({projects,project,episodeId,onProject,onEpisode,onDeleteEpisode,onNewProject,onNewEpisode,onScriptImport,onCharacters}: {
  projects: Project[];
  project: ProjectDetail | null;
  episodeId: string | null;
  onProject: (id: string) => void;
  onEpisode: (id: string) => void;
  onDeleteEpisode:(id:string)=>void;
  onNewProject: () => void;
  onNewEpisode: () => void;
  onScriptImport: () => void;
  onCharacters: () => void;
}) {
  return (
    <aside className="project-nav">
      <div className="project-controls">
        <label htmlFor="project-switcher">当前项目</label>
        <select id="project-switcher" className="project-switcher" aria-label="选择项目" value={project?.id ?? ''} onChange={event => onProject(event.target.value)}>
          {projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <button className="creation-command" onClick={onNewProject}><Plus aria-hidden="true" size={16}/>新建项目</button>
      </div>

      <nav aria-label="项目导航">
        <section className="nav-group" aria-labelledby="episodes-heading">
          <div className="nav-group-heading">
            <h2 id="episodes-heading">剧集</h2>
            <span>{project?.episodes.length ?? 0}</span>
          </div>
          <div className="episode-list">
            {project?.episodes.map((item,index)=><div key={item.id} className={`episode-row ${episodeId===item.id?'active':''}`}><button className="episode-item" aria-current={episodeId===item.id?'page':undefined} onClick={()=>onEpisode(item.id)}><span>{String(index+1).padStart(2,'0')}</span><span><strong>{item.title}</strong><small>{item.status==='planned'?'已规划':'尚未规划'}</small></span></button><button className="episode-delete" aria-label={`删除剧集：${item.title}`} title={`删除剧集：${item.title}`} onClick={()=>onDeleteEpisode(item.id)}><Trash2 aria-hidden="true" size={15}/></button></div>)}
          </div>
          <button className="creation-command" onClick={onNewEpisode}><Plus aria-hidden="true" size={16}/>新建剧集</button>
        </section>

        <section className="nav-group" aria-labelledby="resources-heading">
          <div className="nav-group-heading"><h2 id="resources-heading">项目资料</h2></div>
          <button className="nav-item" onClick={onScriptImport}><FileText aria-hidden="true" size={17}/><span>剧本创作</span></button>
          <button className="nav-item" aria-label="角色设定" onClick={onCharacters}><Users aria-hidden="true" size={17}/><span>角色设定</span><small aria-hidden="true">{project?.characters.length ?? 0}</small></button>
          <button className="nav-item placeholder" title="故事圣经将在后续任务中接入"><BookOpen aria-hidden="true" size={17}/><span>故事圣经</span></button>
        </section>
      </nav>

      <div className="nav-footer"><Clapperboard aria-hidden="true" size={16}/><span>{project?.aspect_ratio ?? '9:16'} 本地项目</span><FileText aria-hidden="true" size={14}/></div>
    </aside>
  );
}
