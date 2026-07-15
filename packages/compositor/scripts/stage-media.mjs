import {copyFileSync} from 'node:fs';
import {extname, resolve} from 'node:path';


export function stageManifestMedia(manifest, stageDir, publicPrefix) {
  for (const [shotIndex, shot] of manifest.shots.entries()) {
    const panelName = `panel-${shotIndex}${extname(shot.panelPath) || '.png'}`;
    copyFileSync(shot.panelPath, resolve(stageDir, panelName));
    shot.panelPath = `${publicPrefix}/${panelName}`;

    if (shot.videoPath) {
      const videoName = `video-${shotIndex}${extname(shot.videoPath) || '.mp4'}`;
      copyFileSync(shot.videoPath, resolve(stageDir, videoName));
      shot.videoPath = `${publicPrefix}/${videoName}`;
    }

    for (const [lineIndex, line] of shot.dialogue.entries()) {
      if (!line.audioPath) continue;
      const audioName = `audio-${shotIndex}-${lineIndex}${extname(line.audioPath) || '.wav'}`;
      copyFileSync(line.audioPath, resolve(stageDir, audioName));
      line.audioPath = `${publicPrefix}/${audioName}`;
    }
    for (const [soundIndex, sound] of (shot.sounds ?? []).entries()) {
      const soundName = `sound-${shotIndex}-${soundIndex}${extname(sound.audioPath) || '.wav'}`;
      copyFileSync(sound.audioPath, resolve(stageDir, soundName));
      sound.audioPath = `${publicPrefix}/${soundName}`;
    }
  }
}
