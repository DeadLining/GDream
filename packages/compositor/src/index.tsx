import React from 'react';
import {Composition, registerRoot, type CalculateMetadataFunction} from 'remotion';
import {ComicEpisode} from './ComicEpisode';
import {durationInFrames, parseManifest, type RenderManifest} from './manifest';

const fallbackManifest: RenderManifest = {
  episode: {id: 'preview', title: 'Preview', width: 1080, height: 1920, fps: 30},
  shots: [
    {
      id: 'preview-shot',
      durationSeconds: 1,
      panelPath:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      reviewStatus: 'approved',
      motion: 'still',
      dialogue: [],
      sounds: [],
    },
  ],
};

const calculateMetadata: CalculateMetadataFunction<{manifest: RenderManifest}> = ({props}) => {
  const manifest = parseManifest(props.manifest);
  return {
    durationInFrames: durationInFrames(manifest),
    fps: manifest.episode.fps,
    width: manifest.episode.width,
    height: manifest.episode.height,
    props: {manifest},
  };
};

const Root: React.FC = () => (
  <Composition
    id="ComicEpisode"
    component={ComicEpisode}
    defaultProps={{manifest: fallbackManifest}}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
    calculateMetadata={calculateMetadata}
  />
);

registerRoot(Root);
