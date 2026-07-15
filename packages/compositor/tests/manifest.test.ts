import {describe, expect, it} from 'vitest';
import {parseManifest} from '../src/manifest';

const baseManifest = {
  episode: {
    id: 'episode-1',
    title: '失窃的雨夜',
    width: 1080,
    height: 1920,
    fps: 30,
  },
  shots: [
    {
      id: 'shot-1',
      durationSeconds: 4,
      panelPath: '/tmp/panel.png',
      reviewStatus: 'approved',
      motion: 'push_in',
      dialogue: [],
    },
  ],
};

describe('parseManifest', () => {
  it('accepts an approved shot with a panel', () => {
    expect(parseManifest(baseManifest).shots).toHaveLength(1);
  });

  it('accepts an optional video while retaining the panel fallback',()=>{
    const mixed: any=structuredClone(baseManifest); mixed.shots[0].videoPath='/tmp/shot.mp4'; mixed.shots[0].videoDurationSeconds=4;
    expect(parseManifest(mixed).shots[0]).toMatchObject({videoPath:'/tmp/shot.mp4',panelPath:'/tmp/panel.png'});
  });

  it('accepts scene sound tracks with bounded volume',()=>{
    const mixed: any=structuredClone(baseManifest);
    mixed.shots[0].sounds=[{id:'sound-1',name:'城市雨声',audioPath:'/tmp/rain.wav',volume:.25}];
    expect(parseManifest(mixed).shots[0].sounds).toEqual(mixed.shots[0].sounds);
  });

  it('rejects a shot without an approved panel', () => {
    const invalid = structuredClone(baseManifest);
    invalid.shots[0].panelPath = '';
    expect(() => parseManifest(invalid)).toThrow();
  });

  it('rejects a shot that is not approved', () => {
    const invalid = structuredClone(baseManifest);
    invalid.shots[0].reviewStatus = 'draft';
    expect(() => parseManifest(invalid)).toThrow();
  });
});
