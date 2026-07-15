import {describe, expect, it} from 'vitest';

// @ts-expect-error The production helper is an ESM script consumed by Node.
import {buildRemotionRenderArgs, resolveBrowserExecutable} from '../scripts/remotion-command.mjs';


describe('Remotion render command', () => {
  it('reuses the installed macOS Chrome executable', () => {
    const browserExecutable = resolveBrowserExecutable(
      {},
      'darwin',
      (path: string) => path === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    );

    expect(browserExecutable).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    expect(buildRemotionRenderArgs('episode.mp4', 'props.json', browserExecutable)).toContainEqual(
      '--browser-executable',
    );
    expect(buildRemotionRenderArgs('episode.mp4', 'props.json', browserExecutable)).toContainEqual(
      browserExecutable,
    );
  });
});
