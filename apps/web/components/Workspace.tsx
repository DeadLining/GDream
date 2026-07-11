'use client';

import {useMemo, useState} from 'react';
import type {EpisodeDetail, Shot} from '../lib/types';
import {AppToolbar} from './AppToolbar';
import {Inspector} from './Inspector';
import {ProjectNavigator} from './ProjectNavigator';
import {Storyboard} from './Storyboard';

export function Workspace({initialEpisode}: {initialEpisode: EpisodeDetail}) {
  const shots = useMemo(() => initialEpisode.scenes.flatMap((scene) => scene.shots), [initialEpisode]);
  const [selectedShot, setSelectedShot] = useState<Shot>(shots[0]);
  const [mobileView, setMobileView] = useState<'shots' | 'inspector'>('shots');

  const selectShot = (shot: Shot) => {
    setSelectedShot(shot);
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 899px)').matches
    ) {
      setMobileView('inspector');
    }
  };

  return (
    <div className="app-shell">
      <AppToolbar />
      <div className="mobile-tabs" role="tablist">
        <button className={mobileView === 'shots' ? 'active' : ''} onClick={() => setMobileView('shots')}>分镜</button>
        <button className={mobileView === 'inspector' ? 'active' : ''} onClick={() => setMobileView('inspector')}>检查器</button>
      </div>
      <div className={`workspace-grid mobile-${mobileView}`}>
        <ProjectNavigator />
        <Storyboard episode={initialEpisode} selectedId={selectedShot.id} onSelect={selectShot} />
        <Inspector shot={selectedShot} />
      </div>
    </div>
  );
}
