import type { CheckedDeviceRead } from '../video/device-selection';
import {
  preferenceFailureOf,
  removalFailure,
  sourceFailureOf,
  type SourceFailure,
} from './source-failure';
import {
  ConnectionError,
  ConnectionErrorReason,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  TrackEvent,
  VideoPresets,
  createLocalTracks,
  setLogLevel,
  LogLevel,
  type LocalTrack,
} from 'livekit-client';
import type { RoundMediaState } from '@daisy/protocol';
import type { BrowserMediaTransport } from './media-controller';
import { mediaRefusal, transientMediaFailure } from './media-failure';

export type MediaTrack = {
  readonly identity: string;
  readonly source: 'camera' | 'microphone';
  readonly local: boolean;
  readonly speaking: boolean;
  readonly muted: boolean;
  readonly track: Track;
};

/** One peer the media room observes now, whether or not this tab subscribes. */
export type RemotePeer = {
  readonly identity: string;
  readonly microphonePublished: boolean;
};

/** The SDK surface this transport uses: livekit-client in the browser, a stub in tests. */
export type MediaSdk = {
  readonly room: () => Room;
  readonly capture: typeof createLocalTracks;
};
const livekit: MediaSdk = {
  room: () =>
    new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
      publishDefaults: {
        simulcast: true,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      },
      reconnectPolicy: { nextRetryDelayInMs: () => null },
      // The media mount owns page exit; an SDK disconnect here reads as an outage.
      disconnectOnPageLeave: false,
    }),
  capture: createLocalTracks,
};

export type Source = 'camera' | 'microphone';
/** Allocated and released only inside one principal/Round transport lifetime. */
type CapturedSource = {
  readonly track: LocalTrack;
  readonly deviceId: string | null;
  readonly release: () => void;
  phase: 'captured' | 'warm' | 'publishing' | 'published' | 'retiring';
  /** A warm microphone is published many times, and watched once. */
  watched: boolean;
};
const capturedSource = (
  track: LocalTrack,
  deviceId: string | null,
): CapturedSource => {
  let held = true;
  return {
    track,
    deviceId,
    phase: 'captured',
    watched: false,
    release: () => {
      if (!held) return;
      held = false;
      track.stop();
    },
  };
};

/**
 * The sources to hold published (ISSUE-572). LiveKit enforces the floor
 * (DEC-218/220) and the server sets its permission from the same seat grants
 * before replying, so once the local permission is known it decides: a
 * microphone opens the moment LiveKit allows it, without waiting for the
 * reconcile reply, and a reply that crossed that change in flight can neither
 * publish nor unpublish against it. Unknown, it is the server's grant.
 */
const desiredSources = (
  granted: readonly Source[],
  permitted: readonly Source[] | null,
): readonly Source[] => permitted ?? granted;

/** Browser SDK only. Opaque identities stay in memory; no SDK diagnostics reach console. */
export function createBrowserMediaTransport(
  events: {
    readonly tracks: (tracks: readonly MediaTrack[]) => void;
    /** Who the room observes now; presence is separate from grants and tracks. */
    readonly remotePeers?: (peers: readonly RemotePeer[]) => void;
    readonly invalidated: () => void;
    readonly reconnect: () => void;
    /** This seat connected elsewhere: this connection must not fight for it. */
    readonly replaced?: () => void;
    /** SDK playback permission is separate from capture and subscription evidence. */
    readonly playbackChanged?: (allowed: boolean) => void;
    /** A successful explicit choice, not an automatic floor/permission mute. */
    readonly microphoneChanged?: (muted: boolean) => void;
    readonly microphoneMuted?: boolean;
    readonly checkedDevices?: () => CheckedDeviceRead;
    /** A device the Room check passed is gone (ISSUE-573); the transport stays up. */
    readonly missing?: (source: Source) => void;
    /**
     * Typed per-source failure report (ISSUE-817/829): a source that cannot
     * capture or publish is reported here with its real error, never eaten
     * behind a blanket catch. A checked device the Room check passed is
     * absent: already reported through `missing`.
     */
    readonly sourceFailed?: (source: Source, failure: SourceFailure) => void;
    /** A source that failed earlier is publishing again; recovery is reported too. */
    readonly sourceHealthy?: (source: Source) => void;
    /** A browser prompt has not answered; this source alone is still pending. */
    readonly sourceWaiting?: (source: Source) => void;
    /** How long a read waits on open prompts before the connection goes live anyway. */
    readonly capturePatience?: (expired: () => void) => () => void;
  },
  sdk: MediaSdk = livekit,
) {
  setLogLevel(LogLevel.silent);
  const room = sdk.room();
  let stopped = false;
  let released = false;
  const sources = new Map<Source, CapturedSource>();
  const all: readonly Source[] = ['camera', 'microphone'];
  /** Failed sources wait for an explicit retry or a newly granted turn. */
  const refused = new Set<Source>();
  const capturing = new Set<Source>();
  const wanted = new Set<Source>();
  let granted: readonly Source[] = [];
  let microphoneMuted = events.microphoneMuted ?? false;
  // Unrestricted sources (canPublish with none listed) are never what the
  // server sets, so they read as unknown rather than as every source.
  const permitted = (): readonly Source[] | null => {
    const permissions = room.localParticipant.permissions;
    if (!permissions) return null;
    if (!permissions.canPublish) return [];
    if (permissions.canPublishSources.length === 0) return null;
    return permissions.canPublishSources
      .map((source) => Track.sourceFromProto(source))
      .flatMap((source) =>
        source === Track.Source.Camera
          ? ['camera' as const]
          : source === Track.Source.Microphone
            ? ['microphone' as const]
            : [],
      );
  };
  const desiredNow = () => desiredSources(granted, permitted());
  const emit = () => {
    // A released room must not overwrite the list its successor now owns.
    if (released) return;
    const snapshot: MediaTrack[] = [];
    for (const participant of [
      room.localParticipant,
      ...room.remoteParticipants.values(),
    ])
      for (const publication of participant.trackPublications.values()) {
        const source =
          publication.source === Track.Source.Camera
            ? 'camera'
            : publication.source === Track.Source.Microphone
              ? 'microphone'
              : null;
        if (
          source &&
          publication.track &&
          publication.track.mediaStreamTrack?.readyState !== 'ended'
        )
          snapshot.push({
            identity: participant.identity,
            source,
            local: participant === room.localParticipant,
            speaking: participant.isSpeaking,
            muted: publication.isMuted,
            track: publication.track,
          });
      }
    events.tracks(snapshot);
    events.remotePeers?.(
      [...room.remoteParticipants.values()].map((participant) => ({
        identity: participant.identity,
        microphonePublished: [...participant.trackPublications.values()].some(
          (publication) => publication.source === Track.Source.Microphone,
        ),
      })),
    );
  };
  const stopTracks = () => {
    if (stopped) return;
    stopped = true;
    for (const resource of sources.values()) resource.release();
    sources.clear();
    events.tracks([]);
    events.remotePeers?.([]);
  };
  room
    .on(RoomEvent.TrackSubscribed, emit)
    .on(RoomEvent.TrackUnsubscribed, emit)
    .on(RoomEvent.TrackPublished, emit)
    .on(RoomEvent.TrackUnpublished, emit)
    .on(RoomEvent.TrackMuted, () => {
      expireEndedTracks();
      emit();
    })
    .on(RoomEvent.TrackUnmuted, emit)
    .on(RoomEvent.LocalTrackPublished, emit)
    .on(RoomEvent.LocalTrackUnpublished, emit)
    .on(RoomEvent.ActiveSpeakersChanged, emit)
    .on(
      RoomEvent.AudioPlaybackStatusChanged,
      () => !stopped && events.playbackChanged?.(room.canPlaybackAudio),
    );
  const invalidate = () => {
    if (!stopped) events.invalidated();
  };
  const observePeers = () => {
    emit();
    invalidate();
  };
  room
    .on(RoomEvent.Connected, observePeers)
    .on(RoomEvent.ParticipantConnected, observePeers)
    .on(RoomEvent.ParticipantDisconnected, observePeers)
    .on(RoomEvent.ParticipantPermissionsChanged, (_previous, participant) => {
      if (stopped) return;
      // A failed publish rejects the queue; the reconcile this invalidation
      // requests then reports it through apply.
      if (participant === room.localParticipant) void settle().catch(() => {});
      events.invalidated();
    });
  // The SDK also fires this for a connect that fails, just before rejecting it.
  let connected = false;
  room.on(RoomEvent.Disconnected, (reason) => {
    if (stopped || !connected) return;
    stopTracks();
    // Another connection holds this seat's identity; rejoining would evict it.
    if (reason === DisconnectReason.DUPLICATE_IDENTITY) events.replaced?.();
    else events.reconnect();
  });
  /** Sources with a failure or a wait on the bar; each must clear when it stops mattering. */
  const reported = new Set<Source>();
  /** A removal report stays until that source's next grant or a Retry: nothing else fixes it. */
  const lingering = new Set<Source>();
  const clearReport = (source: Source) => {
    if (reported.delete(source)) events.sourceHealthy?.(source);
  };
  const reportSourceFailure = (
    source: Source,
    error: unknown,
    checked = false,
  ) => {
    if (stopped) return;
    refused.add(source);
    reported.add(source);
    const failure = sourceFailureOf(error);
    if (checked && failure.kind === 'absence') events.missing?.(source);
    else events.sourceFailed?.(source, failure);
  };
  const readInputs = (): CheckedDeviceRead => {
    try {
      return events.checkedDevices?.() ?? { state: 'available', choices: {} };
    } catch {
      return { state: 'unavailable', reason: 'unreadable' };
    }
  };
  const captureSource = async (source: Source): Promise<CapturedSource[]> => {
    if (stopped) return [];
    const read = readInputs();
    if (stopped) return [];
    if (read.state === 'unavailable') {
      refused.add(source);
      reported.add(source);
      events.sourceFailed?.(source, preferenceFailureOf(read.reason));
      return [];
    }
    // One immutable attempt snapshot supplies both constraints and attribution.
    const choices = { ...read.choices };
    const deviceId = choices[source] ?? null;
    const held = sources.get(source);
    if (held?.phase === 'warm') {
      if (
        held.deviceId === deviceId &&
        held.track.mediaStreamTrack?.readyState !== 'ended'
      )
        return [held];
      held.release();
      if (sources.get(source) === held) sources.delete(source);
    }
    capturing.add(source);
    noteSettling();
    try {
      const captured = await sdk.capture({
        audio:
          source === 'microphone'
            ? choices.microphone
              ? { deviceId: { exact: choices.microphone } }
              : true
            : false,
        video:
          source === 'camera'
            ? {
                resolution: VideoPresets.h360.resolution,
                ...(choices.camera
                  ? { deviceId: { exact: choices.camera } }
                  : {}),
              }
            : false,
      });
      const allocated = captured.map((track) =>
        capturedSource(track, deviceId),
      );
      if (stopped) {
        allocated.forEach((resource) => resource.release());
        return [];
      }
      // Each request asks the SDK for one source and therefore one track.
      if (allocated.length !== 1) {
        allocated.forEach((resource) => resource.release());
        reportSourceFailure(source, new Error('Unexpected source capture'));
        return [];
      }
      sources.set(source, allocated[0]!);
      return allocated;
    } catch (error) {
      reportSourceFailure(source, error, Boolean(choices[source]));
      return [];
    } finally {
      capturing.delete(source);
    }
  };
  /**
   * A seat that publishes anything is a debater's: its microphone waits warm
   * so its grant costs a publish, not a device open. Best effort: a refusal
   * fails only the capture its grant makes, so a camera-only turn keeps its
   * camera and every remote track. A checked microphone that is gone is still
   * reported now through `missing`, since its debater will need it
   * (ISSUE-573). A seat that publishes nothing holds no microphone.
   */
  const warmMicrophone = async (desired: readonly Source[]) => {
    if (stopped) return;
    const held = sources.get('microphone');
    if (desired.length === 0) {
      held?.release();
      sources.delete('microphone');
      return;
    }
    if (desired.includes('microphone') || held || refused.has('microphone'))
      return;
    const [resource] = await captureSource('microphone');
    if (stopped) resource?.release();
    else if (resource && sources.get('microphone') === resource) {
      resource.phase = 'warm';
      events.sourceHealthy?.('microphone');
    }
  };
  /** Unpublishes a source; between turns a debater's microphone stays warm. */
  const retire = async (
    source: Source,
    resource: CapturedSource,
    desired: readonly Source[],
  ) => {
    const keep = source === 'microphone' && desired.length > 0;
    resource.phase = 'retiring';
    if (!keep) {
      resource.release();
      if (sources.get(source) === resource) sources.delete(source);
    }
    try {
      await room.localParticipant.unpublishTrack(resource.track, false);
    } catch {
      resource.release();
      if (sources.get(source) === resource) sources.delete(source);
      if (!stopped) {
        refused.add(source);
        reported.add(source);
        lingering.add(source);
        events.sourceFailed?.(source, removalFailure);
      }
      return;
    }
    if (stopped) resource.release();
    else if (keep && sources.get(source) === resource) resource.phase = 'warm';
  };
  /** A capture the grant no longer wants: a debater's microphone stays warm. */
  const parkUndesired = (source: Source, resource: CapturedSource) => {
    clearReport(source);
    if (source === 'microphone' && desiredNow().length > 0) {
      resource.phase = 'warm';
      return;
    }
    resource.release();
    if (sources.get(source) === resource) sources.delete(source);
  };
  /** A device the SDK could not restart: nothing is left to publish until a retry. */
  const expire = (source: Source, resource: CapturedSource) => {
    resource.phase = 'retiring';
    resource.release();
    if (sources.get(source) === resource) sources.delete(source);
    void Promise.resolve(
      room.localParticipant.unpublishTrack(resource.track, false),
    ).catch(() => undefined);
    reportSourceFailure(source, new DOMException('Ended', 'NotFoundError'));
    emit();
  };
  const expireEndedTracks = () => {
    for (const [source, resource] of sources)
      if (
        resource.phase === 'published' &&
        resource.track.mediaStreamTrack?.readyState === 'ended'
      )
        expire(source, resource);
  };
  /** The SDK may restart a dead device on another input; that swap is never silent. */
  const watchPublished = (source: Source, resource: CapturedSource) => {
    if (resource.watched) return;
    resource.watched = true;
    resource.track
      .on(TrackEvent.Restarted, () => {
        if (
          !stopped &&
          resource.deviceId !== null &&
          resource.track.mediaStreamTrack?.getSettings().deviceId !==
            resource.deviceId
        ) {
          reported.add(source);
          events.missing?.(source);
        }
      })
      // A muted track is never restarted by the SDK, so its end is final here.
      .on(TrackEvent.Ended, () => {
        if (!stopped && resource.track.isMuted) expireEndedTracks();
      });
  };
  const publishSource = async (source: Source) => {
    const captured = await captureSource(source);
    for (const resource of captured) {
      const { track } = resource;
      if (stopped) {
        resource.release();
        continue;
      }
      // Capture can outlive the grant it was asked for; recheck before publishing.
      if (!desiredNow().includes(source)) {
        parkUndesired(source, resource);
        continue;
      }
      resource.phase = 'publishing';
      try {
        if (source === 'microphone' && microphoneMuted) await track.mute();
        if (stopped) {
          resource.release();
          continue;
        }
        await room.localParticipant.publishTrack(track, {
          source:
            source === 'camera' ? Track.Source.Camera : Track.Source.Microphone,
        });
      } catch (error) {
        resource.release();
        if (sources.get(source) === resource) sources.delete(source);
        reportSourceFailure(source, error);
        continue;
      }
      if (stopped) {
        resource.release();
        continue;
      }
      resource.phase = 'published';
      watchPublished(source, resource);
      events.sourceHealthy?.(source);
      emit();
    }
  };
  /** One queue per source: an unanswered prompt holds only its own source. */
  const queues = new Map<Source, Promise<void>>();
  const enqueue = (source: Source, step: () => Promise<void>) => {
    const next = (queues.get(source) ?? Promise.resolve()).then(() =>
      stopped ? undefined : step(),
    );
    queues.set(source, next);
    return next;
  };
  /** Sources with work queued or running; a prompt alone is safe to stop waiting on. */
  const settling = new Map<Source, number>();
  const settlingChanged = new Set<() => void>();
  const noteSettling = () => {
    for (const changed of [...settlingChanged]) changed();
  };
  const tracked = (source: Source, work: () => Promise<void>) => {
    settling.set(source, (settling.get(source) ?? 0) + 1);
    return work().finally(() => {
      const left = (settling.get(source) ?? 1) - 1;
      if (left > 0) settling.set(source, left);
      else settling.delete(source);
      noteSettling();
    });
  };
  const settleSource = (source: Source) =>
    tracked(source, () =>
      enqueue(source, async () => {
        const desired = desiredNow();
        const resource = sources.get(source);
        if (resource?.phase === 'published' && !desired.includes(source))
          await retire(source, resource, desired);
        if (desired.includes(source)) {
          if (
            sources.get(source)?.phase !== 'published' &&
            !refused.has(source)
          )
            await publishSource(source);
        } else if (source === 'microphone') await warmMicrophone(desired);
      }),
    );
  const noteDesired = () => {
    const desired = desiredNow();
    for (const source of all)
      if (desired.includes(source) && !wanted.has(source)) {
        wanted.add(source);
        refused.delete(source);
        lingering.delete(source);
      } else if (!desired.includes(source)) {
        wanted.delete(source);
        const warmable = source === 'microphone' && desired.length > 0;
        if (!warmable && !lingering.has(source)) {
          refused.delete(source);
          clearReport(source);
        }
      }
  };
  /** Local failures are per source; none can invalidate authorized reception. */
  const settle = () => {
    noteDesired();
    return Promise.all(all.map(settleSource)).then(() => {
      if (!stopped) emit();
    });
  };
  const apply = (state: RoundMediaState) => {
    granted = state.grants.publish;
    const settled = settle();
    if (!events.capturePatience) return settled;
    return new Promise<void>((resolve, reject) => {
      let expired = false;
      // Only an open prompt may outlast patience: a hung SDK call must stay visible.
      const onlyPrompts = () => {
        if (!expired) return;
        if (stopped) {
          finish();
          return;
        }
        if ([...settling.keys()].some((source) => !capturing.has(source)))
          return;
        for (const source of capturing) {
          reported.add(source);
          events.sourceWaiting?.(source);
        }
        finish();
      };
      const finish = () => {
        cancel();
        settlingChanged.delete(onlyPrompts);
        resolve();
      };
      settlingChanged.add(onlyPrompts);
      const cancel = events.capturePatience!(() => {
        expired = true;
        onlyPrompts();
      });
      settled.then(finish, (error: unknown) => {
        cancel();
        settlingChanged.delete(onlyPrompts);
        reject(error);
      });
    });
  };
  const transport: BrowserMediaTransport = {
    connect: async (admission) => {
      try {
        await room.connect(admission.url, admission.token, { maxRetries: 0 });
      } catch (error) {
        // The admission was good, so only LiveKit refusing it is about authority.
        // The SDK also says NotAllowed for a room that is gone (404): that passes.
        throw error instanceof ConnectionError &&
          error.reason === ConnectionErrorReason.NotAllowed &&
          (error.status === 401 || error.status === 403)
          ? mediaRefusal()
          : transientMediaFailure();
      }
      connected = true;
      if (stopped) await room.disconnect(true);
    },
    apply,
    allowRecapture: () => {
      refused.clear();
      for (const source of lingering) clearReport(source);
      lingering.clear();
    },
    stopTracks,
    disconnect: async () => {
      released = true;
      stopTracks();
      await room.disconnect(true);
      room.removeAllListeners();
    },
  };
  return {
    transport,
    startAudio: async () => {
      if (stopped) return;
      try {
        await room.startAudio();
        if (!stopped) events.playbackChanged?.(room.canPlaybackAudio);
      } catch (error) {
        if (!stopped) events.playbackChanged?.(false);
        throw error;
      }
    },
    setMicrophoneMuted: async (muted: boolean) => {
      if (stopped) return;
      const previousMuted = microphoneMuted;
      microphoneMuted = muted;
      const resource = sources.get('microphone');
      const owns = () => !stopped && sources.get('microphone') === resource;
      const microphone = resource?.track;
      try {
        if (microphone) await (muted ? microphone.mute() : microphone.unmute());
      } catch (error) {
        resource?.release();
        if (owns()) {
          microphoneMuted = previousMuted;
          sources.delete('microphone');
          reportSourceFailure('microphone', error);
          if (microphone)
            void room.localParticipant
              .unpublishTrack(microphone, false)
              .catch(() => undefined);
          emit();
        }
        throw error;
      }
      if (owns()) events.microphoneChanged?.(muted);
    },
  };
}
