import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {RenderManifest} from './manifest';

const mediaSource = (path: string): string =>
  path.startsWith('public/') ? staticFile(path.slice('public/'.length)) : path;

const ShotScene: React.FC<{shot: RenderManifest['shots'][number]}> = ({shot}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale =
    shot.motion === 'push_in'
      ? 1.04 + progress * 0.1
      : shot.motion === 'pull_out'
        ? 1.14 - progress * 0.1
        : 1.08;
  const translateX =
    shot.motion === 'pan_left'
      ? 5 - progress * 10
      : shot.motion === 'pan_right'
        ? -5 + progress * 10
        : 0;

  return (
    <AbsoluteFill style={{backgroundColor: '#11100f', overflow: 'hidden'}}>
      <Img
        src={mediaSource(shot.panelPath)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `translateX(${translateX}%) scale(${scale})`,
          transformOrigin: 'center',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.02) 45%, rgba(0,0,0,0.72) 100%)',
        }}
      />
      {shot.dialogue.map((line) => {
        const startFrame = Math.round(line.startSeconds * fps);
        const lineFrames = Math.max(1, Math.round(line.durationSeconds * fps));
        return (
          <Sequence key={line.id} from={startFrame} durationInFrames={lineFrames}>
            {line.audioPath ? <Audio src={mediaSource(line.audioPath)} /> : null}
            <AbsoluteFill
              style={{
                justifyContent: 'flex-end',
                alignItems: 'center',
                padding: '0 72px 150px',
              }}
            >
              <div
                style={{
                  width: '100%',
                  borderLeft: '8px solid #e5493f',
                  backgroundColor: 'rgba(18, 17, 16, 0.88)',
                  color: '#f7f3ec',
                  padding: '24px 30px 28px',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                <div style={{fontSize: 28, color: '#f0ba47', marginBottom: 10}}>
                  {line.characterName}
                </div>
                <div style={{fontSize: 44, lineHeight: 1.35}}>{line.text}</div>
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const ComicEpisode: React.FC<{manifest: RenderManifest}> = ({manifest}) => {
  let from = 0;
  return (
    <AbsoluteFill style={{backgroundColor: '#11100f'}}>
      {manifest.shots.map((shot) => {
        const frames = Math.round(shot.durationSeconds * manifest.episode.fps);
        const sequence = (
          <Sequence key={shot.id} from={from} durationInFrames={frames}>
            <ShotScene shot={shot} />
          </Sequence>
        );
        from += frames;
        return sequence;
      })}
    </AbsoluteFill>
  );
};
