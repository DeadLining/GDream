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
