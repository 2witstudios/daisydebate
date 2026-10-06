import { microphoneFrom, requestMicrophone } from '../../speech/microphone';
import type { Recording } from '../../speech/segments';
import { voicedRange } from './trim';

/**
 * The browser side of the AI debate's audio: the shared microphone
 * (`ui/speech/microphone`) and the AI's voice played through Web Audio,
 * which reports exactly how much of a line was heard when it is cut off.
 */

export type Playback = {
  /** Resolves when the clip ends or is stopped. */
  readonly finished: Promise<void>;
  /** When it starts and ends on the engine's timeline (`now`), in ms. */
  readonly startsAt: number;
  readonly endsAt: number;
  readonly durationMs: number;
  /** How much has played so far, in milliseconds. */
  playedMs(): number;
  stop(): void;
};

export type AudioEngine = {
  /** The microphone's RMS level, 0..1. */
  level(): number;
  /** The playback timeline's current time, in milliseconds. */
  now(): number;
  /** Runs `run` when the timeline reaches `time`; returns the cancel. */
  at(time: number, run: () => void): () => void;
  record(): Recording;
  /**
   * Decodes a clip, trims the silence around its voice, and schedules it to
   * start at `at` on the timeline (or at once, if `at` has passed).
   */
  play(mp3: ArrayBuffer, at?: number): Promise<Playback>;
  /** A soft bell: a turn has begun. */
  chime(): void;
  /** Whether an output device reports itself as a headset. */
  usingHeadset(): Promise<boolean>;
  close(): void;
};

/** Must be called from a user gesture: it opens the microphone and audio output. */
export async function openAudioEngine(): Promise<AudioEngine> {
  const stream = await requestMicrophone();
  const context = new AudioContext();
  await context.resume();
  const microphone = microphoneFrom(stream, context);
  return {
    level: microphone.level,
    record: microphone.record,
    now: () => context.currentTime * 1000,
    at(time, run) {
      const timer = setTimeout(
        run,
        Math.max(0, time - context.currentTime * 1000),
      );
      return () => clearTimeout(timer);
    },
    async play(mp3, at = 0) {
      const decoded = await context.decodeAudioData(mp3.slice(0));
      const buffer = trimmed(context, decoded);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const startsAt = Math.max(at, context.currentTime * 1000);
      const durationMs = buffer.duration * 1000;
      let stoppedAt: number | null = null;
      const finished = new Promise<void>((resolve) => {
        source.onended = () => resolve();
      });
      source.start(startsAt / 1000);
      return {
        finished,
        startsAt,
        endsAt: startsAt + durationMs,
        durationMs,
        playedMs: () =>
          Math.min(
            durationMs,
            Math.max(0, (stoppedAt ?? context.currentTime * 1000) - startsAt),
          ),
        stop: () => {
          if (stoppedAt !== null) return;
          stoppedAt = context.currentTime * 1000;
          try {
            source.stop();
          } catch {
            // Already ended.
          }
        },
      };
    },
    chime() {
      const at = context.currentTime;
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
      tone.connect(gain).connect(context.destination);
      tone.start(at);
      tone.stop(at + 0.75);
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
      microphone.close();
      void context.close();
    },
  };
}

/** The clip with the silence before and after its voice cut away. */
function trimmed(context: AudioContext, buffer: AudioBuffer): AudioBuffer {
  const { start, end } = voicedRange(
    buffer.getChannelData(0),
    buffer.sampleRate,
  );
  if (start === 0 && end === buffer.length) return buffer;
  const cut = context.createBuffer(
    buffer.numberOfChannels,
    end - start,
    buffer.sampleRate,
  );
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1)
    cut.copyToChannel(
      buffer.getChannelData(channel).subarray(start, end),
      channel,
    );
  return cut;
}
