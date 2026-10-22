import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';

/** Acknowledged native handoff bracket, not an estimated playout timestamp. */
export type SourceProgress = {
  readonly startSample: number;
  readonly endSample: number;
  readonly beforeMs: number;
  readonly afterMs: number;
};

export async function createAudioPublication(input: {
  readonly url: string;
  readonly token: string;
  readonly trackName: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly monotonicNowMs: () => number;
}) {
  if (
    ![24000, 48000].includes(input.sampleRate) ||
    ![1, 2].includes(input.channels) ||
    !idSchema.safeParse(input.trackName).success
  )
    throw createAppError('VALIDATION', 'Unsupported native PCM format');
  const endpoint = new URL(input.url);
  if (
    !['ws:', 'wss:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  )
    throw createAppError('VALIDATION', 'Invalid media transport endpoint');
  const room = new Room();
  // Zero disables the native pacing queue. Each acknowledgement follows the
  // synchronous OnData handoff of exactly one 10ms frame (ffi 0.13.1).
  const source = new AudioSource(input.sampleRate, input.channels, 0);
  const track = LocalAudioTrack.createAudioTrack(input.trackName, source);
  let closing = false;
  let failed = false;
  let samples = 0;
  let pending: Promise<SourceProgress> | undefined;
  let shutdown: Promise<{ readonly consumedSamples: number }> | undefined;
  try {
    await room.connect(input.url, input.token, {
      autoSubscribe: false,
      dynacast: false,
    });
    if (!room.localParticipant) throw new Error('No local participant');
    await room.localParticipant.publishTrack(
      track,
      new TrackPublishOptions({
        source: TrackSource.SOURCE_MICROPHONE,
        dtx: false,
        red: false,
      }),
    );
  } catch {
    await track.close();
    await room.disconnect();
    throw createAppError('INFRASTRUCTURE', 'Native audio publication failed');
  }
  return {
    capture10ms(data: Int16Array): Promise<SourceProgress> {
      if (closing || failed)
        return Promise.reject(
          createAppError('CONFLICT', 'Audio publication is closed'),
        );
      if (pending)
        return Promise.reject(
          createAppError('CONFLICT', 'A native handoff is outstanding'),
        );
      if (
        !(data instanceof Int16Array) ||
        data.length !== (input.sampleRate / 100) * input.channels
      )
        return Promise.reject(
          createAppError(
            'VALIDATION',
            'A native frame must contain exactly 10ms of PCM16',
          ),
        );
      const capture = async () => {
        const beforeMs = input.monotonicNowMs();
        if (!Number.isFinite(beforeMs))
          throw createAppError('VALIDATION', 'Invalid monotonic instant');
        try {
          // The SDK's pointer helper addresses the underlying buffer, so own a
          // tightly sized copy even when the caller passed an offset subarray.
          await source.captureFrame(
            new AudioFrame(
              new Int16Array(data),
              input.sampleRate,
              input.channels,
              input.sampleRate / 100,
            ),
          );
          const afterMs = input.monotonicNowMs();
          if (!Number.isFinite(afterMs) || afterMs < beforeMs)
            throw new Error('Invalid clock');
          const startSample = samples;
          samples += input.sampleRate / 100;
          return { startSample, endSample: samples, beforeMs, afterMs };
        } catch {
          failed = true;
          throw createAppError('INFRASTRUCTURE', 'Native audio handoff failed');
        }
      };
      pending = capture().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    close(): Promise<{ readonly consumedSamples: number }> {
      if (shutdown) return shutdown;
      closing = true;
      shutdown = (async () => {
        try {
          await pending?.catch(() => undefined);
          source.clearQueue();
          if (room.localParticipant && track.sid)
            await room.localParticipant.unpublishTrack(track.sid, true);
        } finally {
          await track.close();
          await room.disconnect();
        }
        return { consumedSamples: samples };
      })();
      return shutdown;
    },
  };
}
