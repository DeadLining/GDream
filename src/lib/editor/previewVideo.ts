/** Keep one presentation surface. Never expose the media element while changing sources. */
export function createPreviewVideoSync(video: HTMLVideoElement, surface: HTMLCanvasElement, onError: () => void) {
  let source = '';
  let target = 0;
  let playing = false;
  let pending = false;
  let disposed = false;
  let generation = 0;
  let frame: number | undefined;
  let animation: number | undefined;
  const cancelFrame = () => {
    if (frame !== undefined) video.cancelVideoFrameCallback?.(frame);
    if (animation !== undefined) cancelAnimationFrame(animation);
    frame = animation = undefined;
  };
  const play = () => {
    if (playing && video.paused) {
      const expected = generation;
      void video.play().catch(() => { if (!disposed && generation === expected && playing) onError(); });
    } else if (!playing) video.pause();
  };
  const paint = () => {
    if (disposed || pending || video.seeking || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    try {
      const context = surface.getContext('2d');
      if (!context) { onError(); return; }
      // Do not clear/resize on source load. Only replace pixels when a decoded frame exists.
      if (surface.width !== video.videoWidth) surface.width = video.videoWidth;
      if (surface.height !== video.videoHeight) surface.height = video.videoHeight;
      context.drawImage(video, 0, 0);
      surface.style.filter = video.style.filter;
      surface.style.transform = video.style.transform;
      surface.style.display = 'block';
    } catch { onError(); }
  };
  const schedule = () => {
    if (disposed || pending || frame !== undefined || animation !== undefined) return;
    const expected = generation;
    if (video.requestVideoFrameCallback) {
      frame = video.requestVideoFrameCallback(() => {
        if (disposed || generation !== expected) return;
        frame = undefined;
        paint();
        if (playing) schedule();
      });
    } else if (typeof requestAnimationFrame === 'function' && playing) {
      animation = requestAnimationFrame(() => {
        if (disposed || generation !== expected) return;
        animation = undefined;
        paint();
        schedule();
      });
    }
  };
  const loaded = () => {
    if (disposed || video.dataset.src !== source || video.readyState < 1) return;
    if (pending) {
      try { video.currentTime = target; pending = false; } catch { return; }
      play();
    }
    // With rVFC, draw the presented frame rather than relying on canplay/compositor timing.
    if (!video.requestVideoFrameCallback || !playing) paint();
    schedule();
  };
  const error = () => { if (!disposed) onError(); };
  const events = ['loadedmetadata', 'loadeddata', 'canplay', 'seeked'];
  events.forEach(name => video.addEventListener(name, loaded));
  video.addEventListener('error', error);
  return {
    update(src: string, time: number, shouldPlay: boolean, speed: number) {
      target = time;
      playing = shouldPlay;
      if (source !== src) {
        generation++;
        cancelFrame();
        video.pause();
        source = src; video.dataset.src = src; pending = true;
        video.src = src; video.load();
      } else if (!pending && Math.abs(video.currentTime - time) > (playing ? 0.4 : 0.06)) {
        video.currentTime = time;
      }
      video.playbackRate = Math.max(0.1, Math.min(4, speed));
      loaded();
      if (!pending) play();
    },
    dispose() {
      disposed = true; generation++; cancelFrame(); video.pause();
      events.forEach(name => video.removeEventListener(name, loaded));
      video.removeEventListener('error', error);
    },
  };
}

export function previewClipEnded(video: Pick<HTMLVideoElement, 'ended' | 'currentTime'>, outSec: number): boolean {
  return video.ended || video.currentTime >= outSec - 0.03;
}
