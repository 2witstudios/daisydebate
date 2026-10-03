/**
 * The browser side of the AI debate's audio: the microphone (with echo
 * cancellation) and its live level, recording in segments the transcriber
 * can read on their own, and the AI's voice played through Web Audio, which
 * reports exactly how much of a line was heard when it is cut off.
 */

const RECORDING_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
];

export type Playback = {
  /** Resolves when the clip ends or is stopped. */
  readonly finished: Promise<void>;
  readonly durationMs: number;
  /** How much has played so far, in milliseconds. */
  playedMs(): number;
  stop(): void;
};

export type Recording = {
  /** Stops and resolves to the recorded clip (empty when nothing was captured). */
  stop(): Promise<Blob>;
};

export type AudioEngine = {
  /** The microphone's RMS level, 0..1. */
  level(): number;
  record(): Recording;
  play(mp3: ArrayBuffer): Promise<Playback>;
  /** Whether an output device reports itself as a headset. */
  usingHeadset(): Promise<boolean>;
  close(): void;
};

/** Must be called from a user gesture: it opens the microphone and audio output. */
export async function openAudioEngine(): Promise<AudioEngine> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const context = new AudioContext();
  await context.resume();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const mimeType = RECORDING_TYPES.find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  return {
    level() {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      return Math.sqrt(sum / samples.length);
    },
    record() {
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start();
      return {
        stop: () =>
          new Promise<Blob>((resolve) => {
            if (recorder.state === 'inactive') {
              resolve(new Blob(chunks, { type: recorder.mimeType }));
              return;
            }
            recorder.onstop = () =>
              resolve(new Blob(chunks, { type: recorder.mimeType }));
            recorder.stop();
          }),
      };
    },
    async play(mp3) {
      const buffer = await context.decodeAudioData(mp3.slice(0));
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const startedAt = context.currentTime;
      let stoppedAt: number | null = null;
      const finished = new Promise<void>((resolve) => {
        source.onended = () => resolve();
      });
      source.start();
      return {
        finished,
        durationMs: buffer.duration * 1000,
        playedMs: () => ((stoppedAt ?? context.currentTime) - startedAt) * 1000,
        stop: () => {
          if (stoppedAt !== null) return;
          stoppedAt = context.currentTime;
          try {
            source.stop();
          } catch {
            // Already ended.
          }
        },
      };
    },
    async usingHeadset() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.some(
          (device) =>
            device.kind === 'audiooutput' &&
            /headphone|headset|airpods|buds/i.test(device.label),
        );
      } catch {
        return false;
      }
    },
    close() {
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}
