import { sourceFailureOf, type SourceFailure } from './source-failure';
import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  createLocalTracks,
  setLogLevel,
  LogLevel,
  type LocalTrack,
} from 'livekit-client';
import type { RoundMediaState } from '@daisy/protocol';
import type { BrowserMediaTransport } from './media-controller';

export type MediaTrack = {
  readonly identity: string;
  readonly source: 'camera' | 'microphone';
  readonly local: boolean;
  readonly speaking: boolean;
  readonly muted: boolean;
  readonly track: Track;
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
    }),
  capture: createLocalTracks,
};

export type Source = 'camera' | 'microphone';
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
    readonly invalidated: () => void;
    readonly reconnect: () => void;
    /** SDK playback permission is separate from capture and subscription evidence. */
    readonly playbackChanged?: (allowed: boolean) => void;
    /** A successful explicit choice, not an automatic floor/permission mute. */
    readonly microphoneChanged?: (muted: boolean) => void;
    readonly microphoneMuted?: boolean;
    readonly devices?: {
      readonly camera?: string;
      readonly microphone?: string;
    };
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
  },
  sdk: MediaSdk = livekit,
) {
  setLogLevel(LogLevel.silent);
  const room = sdk.room();
  let stopped = false;
  const tracks = new Map<Source, LocalTrack>();
  let granted: readonly Source[] = [];
  /** A debater's microphone, captured but unpublished until its grant (ISSUE-572). */
  let warm: LocalTrack | null = null;
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
  const emit = () => {
    if (stopped) return;
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
  };
  const stopTracks = () => {
    stopped = true;
    for (const track of tracks.values()) track.stop();
    tracks.clear();
    releaseWarm();
    events.tracks([]);
  };
  room
    .on(RoomEvent.TrackSubscribed, emit)
    .on(RoomEvent.TrackUnsubscribed, emit)
    .on(RoomEvent.TrackMuted, emit)
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
  room
    .on(RoomEvent.Connected, invalidate)
    .on(RoomEvent.ParticipantConnected, invalidate)
    .on(RoomEvent.ParticipantDisconnected, invalidate)
    .on(RoomEvent.ParticipantPermissionsChanged, (_previous, participant) => {
      if (stopped) return;
      // A failed publish rejects the queue; the reconcile this invalidation
      // requests then reports it through apply.
      if (participant === room.localParticipant) void settle().catch(() => {});
      events.invalidated();
    });
  room.on(RoomEvent.Disconnected, () => {
    if (!stopped) {
      stopTracks();
      events.reconnect();
    }
  });
  const audioCapture = events.devices?.microphone
    ? { deviceId: { exact: events.devices.microphone } }
    : true;
  /** Device errors are closed source facts; they never invalidate reception. */
  const reportSourceFailure = (source: Source, error: unknown) => {
    if (stopped) return;
    const failure = sourceFailureOf(error);
    if (events.devices?.[source] && failure.kind === 'absence')
      events.missing?.(source);
    else events.sourceFailed?.(source, failure);
  };
  const checked = (source: Source, work: Promise<LocalTrack[]>) =>
    work.catch((error: unknown) => {
      reportSourceFailure(source, error);
      return [];
    });
  const captureSource = async (source: Source) => {
    if (source === 'microphone' && warm) {
      const held = warm;
      warm = null;
      return [held];
    }
    return checked(
      source,
      sdk.capture({
        audio: source === 'microphone' ? audioCapture : false,
        video:
          source === 'camera'
            ? {
                resolution: VideoPresets.h360.resolution,
                ...(events.devices?.camera
                  ? { deviceId: { exact: events.devices.camera } }
                  : {}),
              }
            : false,
      }),
    );
  };
  /**
   * A seat that publishes anything is a debater's: its microphone waits warm
   * so its grant costs a publish, not a device open. Best effort: a refusal
   * fails only the capture its grant makes, so a camera-only turn keeps its
   * camera and every remote track. A checked microphone that is gone is still
   * reported now through `missing`, since its debater will need it
   * (ISSUE-573). A seat that publishes nothing holds no microphone.
   */
  const holdsMicrophone = () =>
    stopped || warm !== null || tracks.has('microphone');
  const releaseWarm = () => {
    warm?.stop();
    warm = null;
  };
  const warmMicrophone = async (desired: readonly Source[]) => {
    if (desired.length === 0) return releaseWarm();
    if (desired.includes('microphone')) return;
    if (holdsMicrophone()) return;
    const [track] = await checked(
      'microphone',
      sdk.capture({ audio: audioCapture, video: false }),
    );
    if (holdsMicrophone()) track?.stop();
    else warm = track ?? null;
  };
  /** Unpublishes a source; between turns a debater's microphone stays warm. */
  const retire = async (
    source: Source,
    track: LocalTrack,
    desired: readonly Source[],
  ) => {
    tracks.delete(source);
    const keep = source === 'microphone' && desired.length > 0 && !warm;
    if (!keep) track.stop();
    await room.localParticipant.unpublishTrack(track, !keep);
    if (!keep) return;
    if (stopped) track.stop();
    else warm = track;
  };
  const publishSource = async (source: Source) => {
    const captured = await captureSource(source);
    for (const track of captured) {
      if (stopped) {
        track.stop();
        continue;
      }
      tracks.set(source, track);
      try {
        if (source === 'microphone' && microphoneMuted) await track.mute();
        await room.localParticipant.publishTrack(track, {
          source:
            source === 'camera' ? Track.Source.Camera : Track.Source.Microphone,
        });
      } catch (error) {
        track.stop();
        tracks.delete(source);
        reportSourceFailure(source, error);
        continue;
      }
      if (stopped) {
        track.stop();
        continue;
      }
      events.sourceHealthy?.(source);
    }
  };
  let work = Promise.resolve();
  /** Serialized and idempotent: each pass publishes only what is missing. */
  const settle = () => {
    work = work.then(async () => {
      if (stopped) return;
      const desired = desiredSources(granted, permitted());
      for (const [source, track] of tracks)
        if (!desired.includes(source)) await retire(source, track, desired);
      // Local capture and publication failures are per source. Even zero
      // local publications cannot invalidate independently authorized reception.
      for (const source of desired) {
        if (stopped) return;
        if (!tracks.has(source)) await publishSource(source);
      }
      await warmMicrophone(desired);
      if (!stopped) emit();
    });
    return work;
  };
  const apply = (state: RoundMediaState) => {
    granted = state.grants.publish;
    return settle();
  };
  const transport: BrowserMediaTransport = {
    connect: async (admission) => {
      await room.connect(admission.url, admission.token, { maxRetries: 0 });
      if (stopped) await room.disconnect(true);
    },
    apply,
    stopTracks,
    disconnect: async () => {
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
      const microphone = tracks.get('microphone') ?? warm;
      try {
        if (microphone) await (muted ? microphone.mute() : microphone.unmute());
      } catch (error) {
        microphoneMuted = previousMuted;
        if (!stopped) {
          microphone?.stop();
          tracks.delete('microphone');
          if (warm === microphone) warm = null;
          reportSourceFailure('microphone', error);
          if (microphone)
            void room.localParticipant
              .unpublishTrack(microphone, true)
              .catch(() => undefined);
          emit();
        }
        throw error;
      }
      if (!stopped) events.microphoneChanged?.(muted);
    },
  };
}
