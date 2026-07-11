import {BookOpen, ChevronDown, Clapperboard, Plus, Users} from 'lucide-react';

export function ProjectNavigator() {
  return (
    <aside className="project-nav">
      <button className="project-switcher">
        <span><span className="project-mark">霓</span><span><strong>霓虹夜行</strong><small>动态漫画系列</small></span></span>
        <ChevronDown size={16} />
      </button>
      <nav aria-label="项目导航">
        <p className="nav-section-label">项目资产</p>
        <button className="nav-item"><BookOpen size={17} />故事设定</button>
        <button className="nav-item"><Users size={17} />角色库<span>2</span></button>
        <p className="nav-section-label episodes-label">剧集</p>
        <button className="episode-item active"><span>01</span><span><strong>失窃的雨夜</strong><small>7 个镜头 · 制作中</small></span></button>
        <button className="episode-item"><span>02</span><span><strong>空白磁带</strong><small>尚未规划</small></span></button>
      </nav>
      <button className="new-episode"><Plus size={16} />新建剧集</button>
      <div className="nav-footer"><Clapperboard size={16} /><span>竖屏 1080 × 1920</span></div>
    </aside>
  );
}
