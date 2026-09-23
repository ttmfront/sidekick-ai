// Screen watcher: captures frames from the primary display so the vision model
// can identify which ADO work item is on screen. Uses Electron's desktopCapturer
// source id via getUserMedia; frames are downscaled JPEGs.

let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;
let canvas: HTMLCanvasElement | null = null;

const bridge = (
  window as unknown as {
    api: { screenSources(): Promise<{ id: string; name: string }[]> };
  }
).api;

export async function startScreen(): Promise<boolean> {
  const sources = await bridge.screenSources();
  if (!sources || sources.length === 0) return false;
  const sourceId = sources[0]?.id;
  if (!sourceId) return false;

  // Electron desktop capture constraints are not in the standard typings.
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: 1600,
        maxHeight: 900
      }
    }
  } as unknown as MediaStreamConstraints;

  stream = await navigator.mediaDevices.getUserMedia(constraints);
  video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  canvas = document.createElement('canvas');
  return true;
}

export function captureFrame(): string | null {
  if (!video || !canvas) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  canvas.width = Math.min(w, 1280);
  canvas.height = Math.round((canvas.width * h) / w);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.6);
}

export function stopScreen(): void {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) {
    video.srcObject = null;
    video = null;
  }
  canvas = null;
}
