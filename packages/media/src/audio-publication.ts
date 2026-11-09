import { createAppError, isAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';

/**
 * Why a publication stopped short: the native connect or a frame handoff
 * failed. Codes only, safe to log (ISSUE-514-r1).
 */
export type PublicationStop = 'connect' | 'handoff';
const STOPS: readonly PublicationStop[] = ['connect', 'handoff'];
/** An INFRASTRUCTURE error that names its stop as its cause. */
export const publicationStopError = (stop: PublicationStop, message: string) =>
  createAppError('INFRASTRUCTURE', message, { stop });
/** The stop an error names, or undefined: never any other part of it. */
export function publicationStopOf(error: unknown): PublicationStop | undefined {
  if (!isAppError(error) || error.code !== 'INFRASTRUCTURE') return undefined;
  const cause: unknown = error.cause;
  const stop =
    cause !== null && typeof cause === 'object' && 'stop' in cause
      ? cause.stop
      : undefined;
  return STOPS.find((known) => known === stop);
}
/** The native queue a publication buffers ahead of playout by default. */
const DEFAULT_QUEUE_MS = 500;

export async function createAudioPublication(input: {
  readonly url: string;
  readonly token: string;
  readonly trackName: string;
  readonly sampleRate: number;
  readonly channels: number;
  /**
   * The native playout buffer: frames handed over within it never wait on
   * anything but the source itself, and `clearQueue` drops them at once.
   */
  readonly queueMs?: number;
}) {
  const queueMs = input.queueMs ?? DEFAULT_QUEUE_MS;
  if (
    ![24000, 48000].includes(input.sampleRate) ||
    ![1, 2].includes(input.channels) ||
    !idSchema.safeParse(input.trackName).success ||
    !Number.isSafeInteger(queueMs) ||
    queueMs < 10 ||
    queueMs > 2000
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
  // A real native queue: the source plays out in real time from it, so a
  // writer's handoff never stalls the stream (ADR 0122).
  const source = new AudioSource(input.sampleRate, input.channels, queueMs);
  const track = LocalAudioTrack.createAudioTrack(input.trackName, source);
  let closing = false;
  let failed = false;
  let samples = 0;
  let pending: Promise<void> | undefined;
  let shutdown: Promise<{ readonly consumedSamples: number }> | undefined;
  const disconnected = Promise.withResolvers<void>();
  // A dropped connection ends the publication: no later frame reaches anyone.
  room.on(RoomEvent.Disconnected, () => {
    failed = true;
    disconnected.resolve();
  });
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
    if (!track.sid) throw new Error('No published track');
  } catch {
    await track.close();
    await room.disconnect();
    throw publicationStopError('connect', 'Native audio publication failed');
  }
  const trackSid = track.sid!;
  return {
    /** The published track's server id, as capture names the track it hears. */
    trackSid,
    /** Settles once the room drops this connection, such as when the server deletes it. */
    disconnected: disconnected.promise,
    /** False once closing, after a failed handoff, or when the room dropped. */
    usable: () => !closing && !failed,
    /** Samples per channel handed to the source so far, across every job. */
    sentSamples: () => samples,
    /**
     * Hands one 10 ms frame to the native queue. It settles at once while the
     * queue has room, and otherwise once playout frees it.
     */
    capture10ms(data: Int16Array): Promise<void> {
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
          samples += input.sampleRate / 100;
        } catch {
          failed = true;
          throw publicationStopError('handoff', 'Native audio handoff failed');
        }
      };
      pending = capture().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    /** Milliseconds handed over but not yet played out. */
    queuedMs: () => source.queuedDuration,
    /** Drops every queued frame now: a stop or barge-in is silent at once. */
    clearQueue: () => source.clearQueue(),
    /**
     * Ends the publication by leaving the room, which ends its track for
     * every subscriber. It never unpublishes first: rtc-node holds the room's
     * event lock through an unpublish, so a room the server already ended
     * (Round cleanup deletes it) refuses or never answers that call, and a
     * claim's stop must settle (ISSUE-789).
     */
    close(): Promise<{ readonly consumedSamples: number }> {
      if (shutdown) return shutdown;
      closing = true;
      shutdown = (async () => {
        try {
          await pending?.catch(() => undefined);
          source.clearQueue();
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
