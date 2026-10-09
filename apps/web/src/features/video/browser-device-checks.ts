import {
  createDeviceCheckController,
  type DeviceCapture,
  type DeviceKind,
  type DeviceLoss,
} from './device-check-controller';

const CHECK_TIMEOUT_MS = 10_000;
const MIC_LEVEL = 0.01;

type BrowserEdge = {
  readonly mediaDevices: MediaDevices;
  readonly document: Document;
  readonly permissions?: Permissions;
  readonly createAudioContext: () => AudioContext;
};

/** Runs a bounded local observation, cleaning all observer resources on cancellation. */
function observe(
  signal: AbortSignal,
  start: (pass: () => void, fail: () => void) => () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let cleanup = () => {};
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const abort = () =>
      finish(new DOMException('Check cancelled', 'AbortError'));
    const timeout = setTimeout(
      () => finish(new Error('No device observation')),
      CHECK_TIMEOUT_MS,
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      cleanup = start(
        () => finish(),
        () => finish(new Error('Device observation unavailable')),
      );
      if (settled) cleanup();
    } catch {
      finish(new Error('Device observation unavailable'));
    }
  });
}

function cameraConfirmation(
  edge: BrowserEdge,
  stream: MediaStream,
  signal: AbortSignal,
) {
  return observe(signal, (pass, fail) => {
    const video = edge.document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    let callback = 0;
    let closed = false;
    void video
      .play()
      .then(() => {
        if (closed) return;
        callback = video.requestVideoFrameCallback(() => {
          if (video.videoWidth > 0 && video.videoHeight > 0) pass();
          else fail();
        });
      })
      .catch(fail);
    return () => {
      closed = true;
      video.cancelVideoFrameCallback(callback);
      video.pause();
      video.srcObject = null;
    };
  });
}
function microphoneConfirmation(
  edge: BrowserEdge,
  stream: MediaStream,
  signal: AbortSignal,
) {
  return observe(signal, (pass, fail) => {
    const context = edge.createAudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser); // Never connect to speakers or any transport.
    const samples = new Float32Array(analyser.fftSize);
    let closed = false;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((sum, sample) => sum + sample * sample, 0) /
          samples.length,
      );
      if (rms >= MIC_LEVEL) pass();
    }, 50);
    void context.resume().catch(fail);
    return () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      void context.close().catch(() => {});
    };
  });
}

function watchLoss(
  edge: BrowserEdge,
  kind: DeviceKind,
  track: MediaStreamTrack,
  loss: (reason: DeviceLoss) => void,
) {
  let active = true;
  let permission: PermissionStatus | undefined;
  const ended = () => {
    if (active) loss('track-ended');
  };
  const revoked = () => {
    if (active && permission?.state === 'denied') loss('permission-denied');
  };
  const changed = () => {
    void edge.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const id = track.getSettings().deviceId;
        if (
          active &&
          id &&
          !devices.some(
            (device) =>
              device.deviceId === id &&
              device.kind === (kind === 'camera' ? 'videoinput' : 'audioinput'),
          )
        )
          loss('device-disappeared');
      })
      .catch(() => {
        if (active) loss('device-disappeared');
      });
  };
  const health = setInterval(() => {
    if (track.readyState === 'ended') ended();
  }, 250);
  track.addEventListener('ended', ended);
  edge.mediaDevices.addEventListener('devicechange', changed);
  if (edge.permissions) {
    void edge.permissions
      .query({
        name: (kind === 'camera' ? 'camera' : 'microphone') as PermissionName,
      })
      .then((status) => {
        if (!active) return;
        permission = status;
        permission.addEventListener('change', revoked);
        revoked();
      })
      .catch(() => {}); // Some browsers expose loss only through the capture track.
  }
  // Track.enabled (publication mute) is deliberately not a device-health signal.
  return () => {
    active = false;
    clearInterval(health);
    track.removeEventListener('ended', ended);
    edge.mediaDevices.removeEventListener('devicechange', changed);
    permission?.removeEventListener('change', revoked);
  };
}

async function openDevice(
  edge: BrowserEdge,
  kind: DeviceKind,
  deviceId: string | null,
): Promise<DeviceCapture> {
  const input = deviceId ? { deviceId: { exact: deviceId } } : true;
  const stream = await edge.mediaDevices.getUserMedia(
    kind === 'camera'
      ? { video: input, audio: false }
      : { audio: input, video: false },
  );
  const track = (
    kind === 'camera' ? stream.getVideoTracks() : stream.getAudioTracks()
  )[0];
  if (!track || track.readyState !== 'live') {
    stream.getTracks().forEach((item) => item.stop());
    throw new Error('Input unavailable');
  }
  return {
    deviceId: track.getSettings().deviceId ?? deviceId ?? '',
    preview: stream,
    confirm: (signal) =>
      kind === 'camera'
        ? cameraConfirmation(edge, stream, signal)
        : microphoneConfirmation(edge, stream, signal),
    onLoss: (listener) => watchLoss(edge, kind, track, listener),
    stop: () => {
      for (const item of stream.getTracks()) item.stop();
    },
  };
}

/** Construct in a client; call check from a user gesture. Local preview only. */
export function createBrowserDeviceChecks(
  edge: BrowserEdge = {
    mediaDevices: navigator.mediaDevices,
    document,
    permissions: navigator.permissions,
    createAudioContext: () => new AudioContext(),
  },
) {
  return createDeviceCheckController({
    open: (kind, deviceId) => openDevice(edge, kind, deviceId),
  });
}
