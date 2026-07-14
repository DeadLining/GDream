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

  it('maps every operations destination to a platform page', () => {
    expect(operationsPlatformPages).toEqual({
      recent: 'home',
      projects: 'home',
      shared: 'home',
      archive: 'home',
      trash: 'trash',
      team: 'team',
      export: 'export',
      settings: 'settings',
    });
  });

  it('rejects unknown operations destinations', () => {
    expect(resolveOperationsPage('unknown')).toBeNull();
  });
});
