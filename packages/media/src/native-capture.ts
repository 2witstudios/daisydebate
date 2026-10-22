import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  AudioStream,
  dispose,
  Room,
  RoomEvent,
  TrackSource,
  type Track,
  type TrackPublication,
  type RemoteParticipant,
} from '@livekit/rtc-node';
import {
  CaptureFrameProcessor,
  type RawCaptureFrame,
} from './capture-frame-processor';

type ClosedTrack = {
  readonly identity: string;
  readonly trackId: string;
  readonly reason:
    'unpublished' | 'disconnected' | 'closed' | 'invalid-callback';
};
type CaptureInput = {
  readonly url: string;
  readonly token: string;
  readonly identities: readonly string[];
  readonly nowMs: () => number;
  readonly onFrame: (frame: RawCaptureFrame) => void;
  readonly onTrackClosed: (track: ClosedTrack) => void;
};
const identitiesOf = (values: readonly string[]) => {
  if (
    values.length > 508 ||
    values.some((value) => !idSchema.safeParse(value).success)
  )
    throw createAppError('VALIDATION', 'Invalid capture participant scope');
  return new Set(values);
};

const validateConnection = (url: string, token: string) => {
  try {
    const parsed = new URL(url);
    if (
      !['ws:', 'wss:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error('Invalid endpoint');
  } catch {
    throw createAppError('VALIDATION', 'Invalid capture endpoint');
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > 16384)
    throw createAppError('VALIDATION', 'Invalid capture credential');
};

/** Raw callback capture only. Calibrated historical eligibility belongs to its worker consumer. */
export async function createCaptureSubscription(input: CaptureInput) {
  validateConnection(input.url, input.token);
  let allowed = identitiesOf(input.identities),
    closing = false;
  const ended = Promise.withResolvers<'disconnected' | 'closed'>();
  const room = new Room();
  const streams = new Map<
    string,
    { identity: string; stop: (reason: ClosedTrack['reason']) => Promise<void> }
  >();
  const start = (
    track: Track,
    publication: TrackPublication,
    participant: RemoteParticipant,
  ) => {
    const trackId = publication.sid,
      identity = participant.identity;
    if (
      closing ||
      !trackId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(trackId) ||
      streams.has(trackId) ||
      publication.source !== TrackSource.SOURCE_MICROPHONE ||
      !allowed.has(identity)
    )
      return;
    let finished = false;
    const processor = new CaptureFrameProcessor({
      identity,
      trackId,
      nowMs: input.nowMs,
      onFrame: input.onFrame,
      onFault: () => {
        queueMicrotask(() => {
          void stop('invalid-callback');
        });
      },
    });
    const reader = new AudioStream(track, {
      sampleRate: 16000,
      numChannels: 1,
      frameSizeMs: 10,
      noiseCancellation: processor,
    }).getReader();
    const stop = async (reason: ClosedTrack['reason']) => {
      if (finished) return;
      finished = true;
      processor.close();
      streams.delete(trackId);
      try {
        await reader.cancel();
      } finally {
        try {
          input.onTrackClosed({ identity, trackId, reason });
        } catch {
          /* Consumer owns recovery; no raw exception enters SDK logs. */
        }
      }
    };
    streams.set(trackId, { identity, stop });
    void (async () => {
      try {
        while (!finished) {
          const frame = await reader.read();
          if (frame.done) break;
        }
      } catch {
        /* Disconnect is handled as a coverage gap below. */
      } finally {
        await stop('disconnected');
        reader.releaseLock();
      }
    })();
  };
  const unpublished = (track: Track) => {
    if (track.sid) void streams.get(track.sid)?.stop('unpublished');
  };
  const disconnected = () => {
    closing = true;
    void Promise.all(
      [...streams.values()].map((stream) => stream.stop('disconnected')),
    ).then(
      () => ended.resolve('disconnected'),
      () =>
        ended.reject(
          createAppError('INFRASTRUCTURE', 'Native capture cleanup failed'),
        ),
    );
  };
  room.on(RoomEvent.TrackSubscribed, start);
  room.on(RoomEvent.TrackUnsubscribed, unpublished);
  room.on(RoomEvent.Disconnected, disconnected);
  const scan = () => {
    for (const participant of room.remoteParticipants.values())
      for (const publication of participant.trackPublications.values())
        if (publication.track)
          start(publication.track, publication, participant);
  };
  try {
    await room.connect(input.url, input.token, {
      autoSubscribe: true,
      dynacast: false,
    });
    scan();
  } catch {
    closing = true;
    await room.disconnect();
    throw createAppError('INFRASTRUCTURE', 'Native capture connection failed');
  }
  let shutdown: Promise<void> | undefined;
  return {
    closed: ended.promise,
    async setIdentities(identities: readonly string[]) {
      if (closing)
        throw createAppError('CONFLICT', 'Native capture connection is closed');
      allowed = identitiesOf(identities);
      await Promise.all(
        [...streams.values()]
          .filter((stream) => !allowed.has(stream.identity))
          .map((stream) => stream.stop('closed')),
      );
      scan();
    },
    close() {
      if (shutdown) return shutdown;
      closing = true;
      shutdown = (async () => {
        await Promise.all(
          [...streams.values()].map((stream) => stream.stop('closed')),
        );
        room.off(RoomEvent.TrackSubscribed, start);
        room.off(RoomEvent.TrackUnsubscribed, unpublished);
        room.off(RoomEvent.Disconnected, disconnected);
        await room.disconnect();
        ended.resolve('closed');
      })();
      return shutdown;
    },
  };
}

/** Process owner only: all native rooms must already be closed. */
export async function disposeCaptureRuntime() {
  await dispose();
}
