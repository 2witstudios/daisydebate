import { createAppError } from '@daisy/errors';
import {
  AudioStream,
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
import { identitiesOf, validateConnection } from './subscription-input';
import {
  createSubscriptionRequests,
  livePublication,
} from './subscription-requests';
import { TransportObservation } from './transport-observation/transport-observation';
import { createSubscriptionIncarnation } from './subscription-incarnation';

type ClosedTrack = {
  readonly identity: string;
  readonly trackId: string;
  readonly generation: number;
  readonly incarnation: string;
  readonly reason:
    'unpublished' | 'disconnected' | 'closed' | 'invalid-callback';
};
type SubscriptionInput = {
  readonly url: string;
  readonly token: string;
  readonly identities: readonly string[];
  readonly nowMs: () => number;
  readonly onFrame: (
    frame: RawAudioFrame & {
      readonly subscriptionGeneration: number;
      readonly subscriptionIncarnation: string;
    },
  ) => void;
  /** A track of an admitted identity is subscribed and being read. */
  readonly onTrackStarted: (track: {
    readonly identity: string;
    readonly trackId: string;
    readonly generation: number;
    readonly incarnation: string;
  }) => void;
  readonly onTrackClosed: (track: ClosedTrack) => void;
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
  const incarnation = createSubscriptionIncarnation();
  let generation = 0;
  const streams = new Map<
    string,
    {
      identity: string;
      generation: number;
      stop: (reason: ClosedTrack['reason']) => Promise<void>;
      transport: ReturnType<typeof TransportObservation.create>;
    }
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
      generation >= Number.MAX_SAFE_INTEGER ||
      !trackId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(trackId) ||
      streams.has(trackId) ||
      publication.source !== TrackSource.SOURCE_MICROPHONE ||
      !allowed.has(identity)
    )
      return;
    requests.subscribed(trackId);
    const subscriptionGeneration = ++generation;
    const transport = TransportObservation.create({
      binding: { incarnation, trackId, generation: subscriptionGeneration },
      nowMs: input.nowMs,
      readStats: (options) => track.getStats(options),
    });
    let finished = false;
    const processor = new AudioFrameProcessor({
      identity,
      trackId,
      nowMs: input.nowMs,
      onFrame: (frame) =>
        input.onFrame({
          ...frame,
          subscriptionGeneration,
          subscriptionIncarnation: incarnation,
        }),
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
    /**
     * The consumer hears the close at once, before the native cancel is
     * awaited: no frame follows (the processor is closed), and a new stream
     * for the same track can only start after this close, never before it.
     */
    const stop = async (reason: ClosedTrack['reason']) => {
      if (finished) return;
      finished = true;
      transport.close();
      processor.close();
      streams.delete(trackId);
      try {
        input.onTrackClosed({
          identity,
          trackId,
          generation: subscriptionGeneration,
          incarnation,
          reason,
        });
      } catch {
        /* Consumer owns recovery; no raw exception enters SDK logs. */
      }
      // An errored stream rejects its cancel; the track is already closed.
      await reader.cancel().catch(() => undefined);
    };
    streams.set(trackId, {
      identity,
      generation: subscriptionGeneration,
      stop,
      transport,
    });
    try {
      input.onTrackStarted({
        identity,
        trackId,
        generation: subscriptionGeneration,
        incarnation,
      });
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
    requests.reconcile(publication, wanted(publication, participant), () =>
      again(participant, sid),
    );
  };
  const subscribeWanted = () => {
    for (const participant of room.remoteParticipants.values())
      for (const publication of participant.trackPublications.values())
        reconcile(publication, participant);
  };
  /**
   * Re-evaluates one publication for a retry, only while its participant is
   * still in the room: a departed participant keeps its stale publications.
   */
  const again = (participant: RemoteParticipant, sid: string) => {
    const publication = livePublication(
      room.remoteParticipants,
      participant,
      sid,
    );
    if (publication) reconcile(publication, participant);
    else requests.ended(sid);
  };
  const subscriptionFailed = (
    trackSid: string,
    participant: RemoteParticipant,
  ) => {
    if (closing) return;
    requests.retry(trackSid, () => again(participant, trackSid));
  };
  /**
   * Unsubscribed while still published (a permission refresh): asked again
   * after the sid's pause if still wanted, never at once, so a flapping
   * track backs off and the old stream has closed before a new one starts.
   */
  const unsubscribed = (
    track: Track,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    if (track.sid) void streams.get(track.sid)?.stop('unpublished');
    const sid = publication.sid;
    if (sid)
      requests.unsubscribed(sid, wanted(publication, participant), () =>
        again(participant, sid),
      );
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
    /** Bounded transport metadata only; no frame/source coverage or hearing authority. */
    async transport(
      binding: {
        readonly incarnation: string;
        readonly trackId: string;
        readonly generation: number;
      },
      signal?: AbortSignal,
    ): Promise<TransportObservation> {
      if (closing) return { kind: 'unknown', reason: 'closed' };
      if (binding.incarnation !== incarnation)
        return { kind: 'unknown', reason: 'unbound' };
      const stream = streams.get(binding.trackId);
      return stream && stream.generation === binding.generation
        ? stream.transport.read(signal)
        : { kind: 'unknown', reason: 'unbound' };
    },
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

export { disposeAudioRuntime } from './audio-runtime';
