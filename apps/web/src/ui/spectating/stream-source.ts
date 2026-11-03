import type { BroadcastStream } from '@daisy/protocol';

export type StreamEngine = 'hlsjs' | 'native';

/** What the browser offers for HLS, read at the edge so the choice stays pure. */
export type HlsSupport = {
  /** Media Source Extensions usable by hls.js. */
  readonly mse: boolean;
  /** `<video>` plays an HLS manifest itself. */
  readonly nativeHls: boolean;
  /** Safari: Apple's own HLS is the right player even where MSE exists. */
  readonly apple: boolean;
};

/** Safari plays natively; everything else through hls.js; null when neither can. */
export const chooseStreamEngine = (
  support: HlsSupport,
): StreamEngine | null => {
  if (support.apple && support.nativeHls) return 'native';
  if (support.mse) return 'hlsjs';
  return support.nativeHls ? 'native' : null;
};

type StreamEvents = {
  /** The engine holds the video and has something to play. */
  readonly onReady: () => void;
  /** No more of this stream can be played, after the engine's own recovery. */
  readonly onFailed: () => void;
};

/** Detaches a stream from its video and frees everything it held. */
type Detach = () => void;

const NATIVE_HLS_TYPE = 'application/vnd.apple.mpegurl';

/** How often one viewing recovers a fatal error before it says it failed. */
const FATAL_RECOVERIES = 3;

/**
 * The transmuxer's own file, served from this origin, keeps a 720p stream off the
 * main thread. hls.js's other way, a blob of a stringified function, dies in a
 * minified bundle and then falls back to the main thread without a word.
 */
const HLS_WORKER_URL = new URL(
  '../../../node_modules/hls.js/dist/hls.worker.js',
  import.meta.url,
).href;

const attachNative = (
  video: HTMLVideoElement,
  manifestUrl: string,
  events: StreamEvents,
): Detach => {
  const failed = () => events.onFailed();
  video.addEventListener('error', failed);
  video.src = manifestUrl;
  events.onReady();
  return () => {
    video.removeEventListener('error', failed);
    video.removeAttribute('src');
    video.load();
  };
};

const attachHlsJs = (
  video: HTMLVideoElement,
  manifestUrl: string,
  events: StreamEvents,
): Detach => {
  let detached = false;
  let destroy: Detach = () => undefined;
  void import('hls.js')
    .then(({ default: Hls }) => {
      if (detached) return;
      const hls = new Hls({
        enableWorker: true,
        workerPath: HLS_WORKER_URL,
        capLevelToPlayerSize: true,
      });
      let recoveries = 0;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        recoveries += 1;
        if (recoveries > FATAL_RECOVERIES) {
          hls.destroy();
          events.onFailed();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR)
          hls.recoverMediaError();
        else hls.startLoad();
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => events.onReady());
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);
      destroy = () => hls.destroy();
    })
    .catch(() => events.onFailed());
  return () => {
    detached = true;
    destroy();
  };
};

/** Reads what this browser can do, at the edge. */
export const browserHlsSupport = (video: HTMLVideoElement): HlsSupport => ({
  mse: typeof MediaSource !== 'undefined',
  nativeHls: video.canPlayType(NATIVE_HLS_TYPE) !== '',
  apple: navigator.vendor.includes('Apple'),
});

type Attach = (
  video: HTMLVideoElement,
  stream: Pick<BroadcastStream, 'path' | 'manifestUrl'>,
  engine: StreamEngine,
  events: StreamEvents,
) => Detach;

/** One source per delivery path: a faster path adds an entry and leaves the player as it is. */
const sources: Readonly<Record<BroadcastStream['path'], Attach>> = {
  owned_hls: (video, stream, engine, events) =>
    engine === 'native'
      ? attachNative(video, stream.manifestUrl, events)
      : attachHlsJs(video, stream.manifestUrl, events),
};

/** Plays a stream's delivery path in a video. */
export const attachStream: Attach = (video, stream, engine, events) =>
  sources[stream.path](video, stream, engine, events);
