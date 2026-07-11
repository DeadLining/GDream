import {BookOpen, Clapperboard, FileText, Plus, Settings2, Users} from 'lucide-react';
import type {Project, ProjectDetail} from '../lib/types';

export function ProjectNavigator({projects, project, episodeId, onProject, onEpisode, onNewProject, onNewEpisode, onScriptImport, onCharacters, onProviderSettings}: {
  projects: Project[];
  project: ProjectDetail | null;
  episodeId: string | null;
  onProject: (id: string) => void;
  onEpisode: (id: string) => void;
  onNewProject: () => void;
  onNewEpisode: () => void;
  onScriptImport: () => void;
  onCharacters: () => void;
  onProviderSettings: () => void;
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
            {project?.episodes.map((episode, index) => (
              <button
                key={episode.id}
                className={`episode-item ${episodeId === episode.id ? 'active' : ''}`}
                aria-current={episodeId === episode.id ? 'page' : undefined}
                onClick={() => onEpisode(episode.id)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <span><strong>{episode.title}</strong><small>{episode.status === 'planned' ? '已规划' : '尚未规划'}</small></span>
              </button>
            ))}
          </div>
          <button className="creation-command" onClick={onNewEpisode}><Plus aria-hidden="true" size={16}/>新建剧集</button>
        </section>

        <section className="nav-group" aria-labelledby="resources-heading">
          <div className="nav-group-heading"><h2 id="resources-heading">项目资料</h2></div>
          <button className="nav-item" onClick={onScriptImport}><FileText aria-hidden="true" size={17}/><span>剧本创作</span></button>
          <button className="nav-item" aria-label="角色设定" onClick={onCharacters}><Users aria-hidden="true" size={17}/><span>角色设定</span><small aria-hidden="true">{project?.characters.length ?? 0}</small></button>
          <button className="nav-item placeholder" title="故事圣经将在后续任务中接入"><BookOpen aria-hidden="true" size={17}/><span>故事圣经</span></button>
        </section>
        <section className="nav-group" aria-labelledby="settings-heading">
          <div className="nav-group-heading"><h2 id="settings-heading">工作室设置</h2></div>
          <button className="nav-item" onClick={onProviderSettings}><Settings2 aria-hidden="true" size={17}/><span>模型渠道</span></button>
        </section>
      </nav>

      <div className="nav-footer"><Clapperboard aria-hidden="true" size={16}/><span>{project?.aspect_ratio ?? '9:16'} 本地项目</span><FileText aria-hidden="true" size={14}/></div>
    </aside>
  );
}
