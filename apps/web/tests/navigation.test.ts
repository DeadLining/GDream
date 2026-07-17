import {describe, expect, it} from 'vitest';
import {
  globalSectionWorkAreas,
  operationsPlatformPages,
  resolveOperationsPage,
} from '../lib/navigation';

describe('workspace navigation model', () => {
  it('keeps every product section mapped to its primary work area', () => {
    expect(globalSectionWorkAreas).toEqual({
      overview: 'overview',
      script: 'import',
      assets: 'characters',
      episode: 'overview',
      review: 'review',
    });
  });

  it('maps every real operations destination to a platform page', () => {
    expect(operationsPlatformPages).toEqual({
      recent: 'home',
      projects: 'home',
      trash: 'trash',
      export: 'export',
    });
  });

  it('does not expose fake archive or collaboration destinations', () => {
    expect(resolveOperationsPage('archive')).toBeNull();
    expect(resolveOperationsPage('shared')).toBeNull();
    expect(resolveOperationsPage('team')).toBeNull();
    expect(resolveOperationsPage('settings')).toBeNull();
  });

  it('rejects unknown operations destinations', () => {
    expect(resolveOperationsPage('unknown')).toBeNull();
  });
});
