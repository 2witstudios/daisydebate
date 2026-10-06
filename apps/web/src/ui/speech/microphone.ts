import { defaultTurnTakingSettings } from '@daisy/ai-voice';
import type { Clip, Recording } from './segments';

/**
 * The browser's microphone for a transcribed speech: echo-cancelled, with
 * its live level, recording clips that count how long a voice was heard.
 */

const RECORDING_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
];

export type Microphone = {
  /** The microphone's RMS level, 0..1. */
  level(): number;
  record(): Recording;
  /** Releases the microphone. */
  close(): void;
};

/** Must be called from a user gesture: it asks for the microphone. */
export function requestMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

/** Listens to `stream` through `context`, which the caller owns and closes. */
export function microphoneFrom(
  stream: MediaStream,
  context: AudioContext,
): Microphone {
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const mimeType = RECORDING_TYPES.find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  const level = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    return Math.sqrt(sum / samples.length);
  };
  return {
    level,
    record() {
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      let voicedMs = 0;
      const listen = setInterval(() => {
        if (level() >= defaultTurnTakingSettings.speechLevel) voicedMs += 100;
      }, 100);
      const clip = (): Clip => ({
        blob: new Blob(chunks, { type: recorder.mimeType }),
        voicedMs,
      });
      recorder.start();
      return {
        stop: () =>
          new Promise<Clip>((resolve) => {
            clearInterval(listen);
            if (recorder.state === 'inactive') {
              resolve(clip());
              return;
            }
            recorder.onstop = () => resolve(clip());
            recorder.stop();
          }),
      };
    },
    close() {
      for (const track of stream.getTracks()) track.stop();
    },
  };
}
