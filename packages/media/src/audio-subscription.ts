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
  type RemoteTrackPublication,
} from '@livekit/rtc-node';
import {
  AudioFrameProcessor,
  type RawAudioFrame,
} from './audio-frame-processor';
import { createSubscriptionRequests } from './subscription-requests';

type ClosedTrack = {
  readonly identity: string;
  readonly trackId: string;
  readonly reason:
    'unpublished' | 'disconnected' | 'closed' | 'invalid-callback';
};
type SubscriptionInput = {
  readonly url: string;
  readonly token: string;
  readonly identities: readonly string[];
  readonly nowMs: () => number;
  readonly onFrame: (frame: RawAudioFrame) => void;
  /** A track of an admitted identity is subscribed and being read. */
  readonly onTrackStarted: (track: {
    readonly identity: string;
    readonly trackId: string;
  }) => void;
  readonly onTrackClosed: (track: ClosedTrack) => void;
};
const identitiesOf = (values: readonly string[]) => {
  if (
    values.length > 508 ||
    values.some((value) => !idSchema.safeParse(value).success)
  )
    throw createAppError(
      'VALIDATION',
      'Invalid subscription participant scope',
    );
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
    throw createAppError('VALIDATION', 'Invalid subscription endpoint');
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > 16384)
    throw createAppError('VALIDATION', 'Invalid subscription credential');
};

const connectionClosed = new WeakSet<object>();
/** The refusal of a connection LiveKit (or close) has already closed. */
export function subscriptionClosed() {
  const error = createAppError(
    'CONFLICT',
    'Native audio subscription is closed',
  );
  connectionClosed.add(error);
  return error;
}
/** Whether a call was refused only because the connection had closed. */
export const isSubscriptionClosed = (error: unknown) =>
  typeof error === 'object' && error !== null && connectionClosed.has(error);

/** Raw callback audio only, for any media worker role (capture, bot listening). Calibrated eligibility belongs to its consumer. */
export async function createAudioSubscription(input: SubscriptionInput) {
  validateConnection(input.url, input.token);
  let allowed = identitiesOf(input.identities),
    closing = false;
  const ended = Promise.withResolvers<'disconnected' | 'closed'>();
  const room = new Room();
  const streams = new Map<
    string,
    { identity: string; stop: (reason: ClosedTrack['reason']) => Promise<void> }
  >();
  const requests = createSubscriptionRequests({
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
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
    requests.subscribed(trackId);
    let finished = false;
    const processor = new AudioFrameProcessor({
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
    try {
      input.onTrackStarted({ identity, trackId });
    } catch {
      /* Consumer owns its report; no raw exception enters SDK logs. */
    }
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
  /**
   * Only admitted identities' microphones are subscribed: no camera or other
   * track ever reaches this process (autoSubscribe is off). A refused or
   * unanswered subscription is asked again (`createSubscriptionRequests`).
   */
  const wanted = (
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) =>
    publication.source === TrackSource.SOURCE_MICROPHONE &&
    allowed.has(participant.identity);
  const reconcile = (
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void => {
    if (closing || !publication.sid) return;
    const sid = publication.sid;
    requests.reconcile(publication, wanted(publication, participant), () => {
      const current = participant.trackPublications.get(sid);
      if (current) reconcile(current, participant);
    });
  };
  const subscribeWanted = () => {
    for (const participant of room.remoteParticipants.values())
      for (const publication of participant.trackPublications.values())
        reconcile(publication, participant);
  };
  const subscriptionFailed = (
    trackSid: string,
    participant: RemoteParticipant,
  ) => {
    if (closing) return;
    requests.refused(trackSid, () => {
      const publication = participant.trackPublications.get(trackSid);
      if (publication) reconcile(publication, participant);
    });
  };
  const unsubscribed = (track: Track, publication: TrackPublication) => {
    if (publication.sid) requests.ended(publication.sid);
    if (track.sid) void streams.get(track.sid)?.stop('unpublished');
  };
  /** Unpublished before its track arrived: nothing will answer the ask. */
  const unpublished = (publication: RemoteTrackPublication) => {
    if (publication.sid) requests.ended(publication.sid);
  };
  const disconnected = () => {
    closing = true;
    requests.close();
    void Promise.all(
      [...streams.values()].map((stream) => stream.stop('disconnected')),
    ).then(
      () => ended.resolve('disconnected'),
      () =>
        ended.reject(
          createAppError(
            'INFRASTRUCTURE',
            'Native audio subscription cleanup failed',
          ),
        ),
    );
  };
  room.on(RoomEvent.TrackPublished, reconcile);
  room.on(RoomEvent.TrackSubscriptionFailed, subscriptionFailed);
  room.on(RoomEvent.TrackSubscribed, start);
  room.on(RoomEvent.TrackUnsubscribed, unsubscribed);
  room.on(RoomEvent.TrackUnpublished, unpublished);
  room.on(RoomEvent.Disconnected, disconnected);
  const scan = () => {
    for (const participant of room.remoteParticipants.values())
      for (const publication of participant.trackPublications.values())
        if (publication.track)
          start(publication.track, publication, participant);
  };
  try {
    await room.connect(input.url, input.token, {
      autoSubscribe: false,
      dynacast: false,
    });
    subscribeWanted();
    scan();
  } catch {
    closing = true;
    await room.disconnect();
    throw createAppError('INFRASTRUCTURE', 'Native audio subscription failed');
  }
  let shutdown: Promise<void> | undefined;
  return {
    closed: ended.promise,
    async setIdentities(identities: readonly string[]) {
      if (closing) throw subscriptionClosed();
      allowed = identitiesOf(identities);
      await Promise.all(
        [...streams.values()]
          .filter((stream) => !allowed.has(stream.identity))
          .map((stream) => stream.stop('closed')),
      );
      subscribeWanted();
      scan();
    },
    close() {
      if (shutdown) return shutdown;
      closing = true;
      requests.close();
      shutdown = (async () => {
        await Promise.all(
          [...streams.values()].map((stream) => stream.stop('closed')),
        );
        room.off(RoomEvent.TrackPublished, reconcile);
        room.off(RoomEvent.TrackSubscriptionFailed, subscriptionFailed);
        room.off(RoomEvent.TrackSubscribed, start);
        room.off(RoomEvent.TrackUnsubscribed, unsubscribed);
        room.off(RoomEvent.TrackUnpublished, unpublished);
        room.off(RoomEvent.Disconnected, disconnected);
        await room.disconnect();
        ended.resolve('closed');
      })();
      return shutdown;
    },
  };
}

/** Process owner only: all native rooms must already be closed. */
export async function disposeAudioRuntime() {
  await dispose();
}
