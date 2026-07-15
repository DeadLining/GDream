import {existsSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {describe, expect, it} from 'vitest';

// @ts-expect-error The production helper is an ESM script consumed by Node.
import {stageManifestMedia} from '../scripts/stage-media.mjs';


describe('Remotion media staging', () => {
  it('copies shot videos into the public job directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'comic-stage-'));
    const videoPath = join(root, 'shot.mp4');
    writeFileSync(videoPath, Buffer.from('video'));
    const manifest = {shots: [{panelPath: videoPath, videoPath, dialogue: [], sounds: []}]};

    stageManifestMedia(manifest, root, 'public/jobs/test-job');

    expect(manifest.shots[0].videoPath).toBe('public/jobs/test-job/video-0.mp4');
    expect(existsSync(join(root, 'video-0.mp4'))).toBe(true);
  });
});
