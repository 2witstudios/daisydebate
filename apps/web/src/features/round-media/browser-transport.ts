import type { CheckedDeviceRead } from '../video/device-selection';
import {
  preferenceFailureOf,
  sourceFailureOf,
  type SourceFailure,
} from './source-failure';
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
/** Allocated and released only inside one principal/Round transport lifetime. */
type CapturedSource = {
  readonly track: LocalTrack;
  readonly deviceId: string | null;
  readonly release: () => void;
  phase: 'captured' | 'warm' | 'publishing' | 'published' | 'retiring';
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
    readonly invalidated: () => void;
    readonly reconnect: () => void;
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
  },
  sdk: MediaSdk = livekit,
) {
  setLogLevel(LogLevel.silent);
  const room = sdk.room();
  let stopped = false;
  const sources = new Map<Source, CapturedSource>();
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
    if (stopped) return;
    stopped = true;
    for (const resource of sources.values()) resource.release();
    sources.clear();
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
  const reportSourceFailure = (
    source: Source,
    error: unknown,
    checked = false,
  ) => {
    if (stopped) return;
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
    if (desired.includes('microphone') || held) return;
    const [resource] = await captureSource('microphone');
    if (stopped) resource?.release();
    else if (resource && sources.get('microphone') === resource)
      resource.phase = 'warm';
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
    } catch (error) {
      resource.release();
      if (sources.get(source) === resource) sources.delete(source);
      reportSourceFailure(source, error);
      return;
    }
    if (stopped) resource.release();
    else if (keep && sources.get(source) === resource) resource.phase = 'warm';
  };
  const publishSource = async (source: Source) => {
    const captured = await captureSource(source);
    for (const resource of captured) {
      const { track } = resource;
      if (stopped) {
        resource.release();
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
      events.sourceHealthy?.(source);
    }
  };
  let work = Promise.resolve();
  /** Serialized and idempotent: each pass publishes only what is missing. */
  const settle = () => {
    work = work.then(async () => {
      if (stopped) return;
      const desired = desiredSources(granted, permitted());
      for (const [source, resource] of sources)
        if (resource.phase === 'published' && !desired.includes(source))
          await retire(source, resource, desired);
      // Local capture and publication failures are per source. Even zero
      // local publications cannot invalidate independently authorized reception.
      for (const source of desired) {
        if (stopped) return;
        if (sources.get(source)?.phase !== 'published')
          await publishSource(source);
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
