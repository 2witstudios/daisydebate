import {
  ConnectionError,
  ConnectionErrorReason,
  DisconnectReason,
  LogLevel,
  Room,
  RoomEvent,
  Track,
  TrackEvent,
  VideoPresets,
  createLocalTracks,
  setLogLevel,
  type LocalTrack,
} from 'livekit-client';
import type { RoundMediaAdmission } from '@daisy/protocol';
import type { CheckedDeviceRead } from '../../video/device-selection';
import type { RoomEvent as MediaRoomEvent } from '../model/media-events';
import type { ObservedTrack, Source } from '../model/media-state';
import { preferenceFailureOf, sourceFailureOf } from '../source-failure';

/** The SDK surface used: livekit-client in the browser, a stub in tests. */
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

/** A track to attach to an element. It decides nothing. */
export type TrackHandle = ObservedTrack & { readonly track: Track };

type HeldTrack = {
  readonly track: LocalTrack;
  readonly deviceId: string | null;
  held: boolean;
  /** A warm microphone is published many times, and watched once. */
  watched: boolean;
  published: boolean;
};

export type MediaRoom = ReturnType<typeof createLiveKitRoom>;

/**
 * The SDK adapter: it reports what happened and does what it is told. Every decision
 * about a source is the model's. Opaque identities stay in memory, and no SDK
 * diagnostics reach the console.
 */
export function createLiveKitRoom(
  input: {
    readonly report: (event: MediaRoomEvent) => void;
    readonly handles: (handles: readonly TrackHandle[]) => void;
    readonly checkedDevices: () => CheckedDeviceRead;
  },
  sdk: MediaSdk = livekit,
) {
  setLogLevel(LogLevel.silent);
  const room = sdk.room();
  let released = false;
  // The SDK also fires Disconnected for a connect that fails, just before rejecting.
  let connected = false;
  const held = new Map<Source, HeldTrack>();
  const { report } = input;
  const say = (event: MediaRoomEvent) => {
    if (!released) report(event);
  };
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
  const observe = () => {
    if (released) return;
    const snapshot: TrackHandle[] = [];
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
    input.handles(snapshot);
    say({
      type: 'observed',
      tracks: snapshot.map(({ identity, source, local, speaking, muted }) => ({
        identity,
        source,
        local,
        speaking,
        muted,
      })),
      peers: [...room.remoteParticipants.values()].map((participant) => ({
        identity: participant.identity,
        microphonePublished: [...participant.trackPublications.values()].some(
          (publication) => publication.source === Track.Source.Microphone,
        ),
      })),
    });
  };
  const reportEndedTracks = () => {
    for (const [source, resource] of held)
      if (
        resource.published &&
        resource.track.mediaStreamTrack?.readyState === 'ended'
      ) {
        resource.published = false;
        say({ type: 'track-ended', source });
      }
  };
  const playback = () =>
    say({ type: 'playback-changed', allowed: room.canPlaybackAudio });
  const peersMoved = () => {
    observe();
    say({ type: 'room-changed' });
  };
  room
    .on(RoomEvent.TrackSubscribed, observe)
    .on(RoomEvent.TrackUnsubscribed, observe)
    .on(RoomEvent.TrackPublished, observe)
    .on(RoomEvent.TrackUnpublished, observe)
    .on(RoomEvent.TrackMuted, () => {
      reportEndedTracks();
      observe();
    })
    .on(RoomEvent.TrackUnmuted, observe)
    .on(RoomEvent.LocalTrackPublished, observe)
    .on(RoomEvent.LocalTrackUnpublished, observe)
    .on(RoomEvent.ActiveSpeakersChanged, observe)
    .on(RoomEvent.AudioPlaybackStatusChanged, playback)
    .on(RoomEvent.Connected, peersMoved)
    .on(RoomEvent.ParticipantConnected, peersMoved)
    .on(RoomEvent.ParticipantDisconnected, peersMoved)
    .on(RoomEvent.ParticipantPermissionsChanged, (_previous, participant) => {
      if (participant === room.localParticipant)
        say({ type: 'permission-changed', permission: permitted() });
      else say({ type: 'room-changed' });
    });
  room.on(RoomEvent.Disconnected, (reason) => {
    if (!connected) return;
    releaseTracks();
    input.handles([]);
    // Another connection holds this seat's identity; rejoining would evict it.
    say(
      reason === DisconnectReason.DUPLICATE_IDENTITY
        ? { type: 'replaced' }
        : { type: 'dropped' },
    );
  });
  const releaseTracks = () => {
    for (const resource of held.values()) releaseOne(resource);
    held.clear();
  };
  const releaseOne = (resource: HeldTrack) => {
    if (!resource.held) return;
    resource.held = false;
    resource.track.stop();
  };
  /** The SDK may restart a dead device on another input; that swap is never silent. */
  const watch = (source: Source, resource: HeldTrack) => {
    if (resource.watched) return;
    resource.watched = true;
    resource.track
      .on(TrackEvent.Restarted, () => {
        if (
          resource.deviceId !== null &&
          resource.track.mediaStreamTrack?.getSettings().deviceId !==
            resource.deviceId
        )
          say({ type: 'device-swapped', source });
      })
      // A muted track is never restarted by the SDK, so its end is final here.
      .on(TrackEvent.Ended, () => {
        if (resource.track.isMuted) reportEndedTracks();
      });
  };
  const readChoices = (): CheckedDeviceRead => {
    try {
      return input.checkedDevices();
    } catch {
      return { state: 'unavailable', reason: 'unreadable' };
    }
  };
  return {
    connect: async (admission: RoundMediaAdmission) => {
      try {
        await room.connect(admission.url, admission.token, { maxRetries: 0 });
      } catch (error) {
        // The admission was good, so only LiveKit refusing it is about authority.
        // The SDK also says NotAllowed for a room that is gone (404): that passes.
        say({
          type: 'connect-failed',
          failure:
            error instanceof ConnectionError &&
            error.reason === ConnectionErrorReason.NotAllowed &&
            (error.status === 401 || error.status === 403)
              ? 'ending'
              : 'transient',
        });
        return;
      }
      connected = true;
      if (released) {
        await room.disconnect(true);
        return;
      }
      say({ type: 'connected', permission: permitted() });
      observe();
    },
    /** One immutable attempt snapshot supplies both constraints and attribution. */
    capture: async (source: Source) => {
      const read = readChoices();
      if (read.state === 'unavailable') {
        say({
          type: 'capture-failed',
          source,
          kind: preferenceFailureOf(read.reason).kind,
          checked: false,
        });
        return;
      }
      const choices = { ...read.choices };
      const deviceId = choices[source] ?? null;
      const current = held.get(source);
      if (
        current?.held &&
        current.deviceId === deviceId &&
        current.track.mediaStreamTrack?.readyState !== 'ended'
      ) {
        say({ type: 'captured', source });
        return;
      }
      if (current) {
        releaseOne(current);
        held.delete(source);
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
        // Each request asks the SDK for one source and therefore one track.
        if (released || captured.length !== 1) {
          for (const track of captured) track.stop();
          if (!released)
            say({
              type: 'capture-failed',
              source,
              kind: sourceFailureOf(new Error('Unexpected source capture'))
                .kind,
              checked: false,
            });
          return;
        }
        held.set(source, {
          track: captured[0]!,
          deviceId,
          held: true,
          watched: false,
          published: false,
        });
        say({ type: 'captured', source });
      } catch (error) {
        say({
          type: 'capture-failed',
          source,
          kind: sourceFailureOf(error).kind,
          checked: Boolean(choices[source]),
        });
      }
    },
    publish: async (source: Source, muted: boolean) => {
      const resource = held.get(source);
      if (!resource) return;
      try {
        if (source === 'microphone' && muted) await resource.track.mute();
        if (released) return;
        await room.localParticipant.publishTrack(resource.track, {
          source:
            source === 'camera' ? Track.Source.Camera : Track.Source.Microphone,
        });
      } catch (error) {
        say({
          type: 'publish-failed',
          source,
          kind: sourceFailureOf(error).kind,
        });
        return;
      }
      if (released) {
        releaseOne(resource);
        return;
      }
      resource.published = true;
      watch(source, resource);
      say({ type: 'published', source });
      observe();
    },
    unpublish: async (source: Source) => {
      const resource = held.get(source);
      if (!resource) return;
      resource.published = false;
      try {
        await room.localParticipant.unpublishTrack(resource.track, false);
      } catch {
        say({ type: 'unpublish-failed', source });
        return;
      }
      if (released) releaseOne(resource);
      else if (!resource.held && held.get(source) === resource)
        held.delete(source);
      say({ type: 'unpublished', source });
      observe();
    },
    releaseTrack: (source: Source) => {
      const resource = held.get(source);
      if (resource) releaseOne(resource);
    },
    setMuted: async (muted: boolean) => {
      const resource = held.get('microphone');
      const microphone = resource?.track;
      // A replacement microphone is not what this outcome is about.
      const stale = () => held.get('microphone') !== resource;
      try {
        if (microphone) await (muted ? microphone.mute() : microphone.unmute());
      } catch (error) {
        say(
          stale()
            ? { type: 'mute-abandoned' }
            : { type: 'mute-failed', kind: sourceFailureOf(error).kind },
        );
        return;
      }
      say(
        stale() ? { type: 'mute-abandoned' } : { type: 'mute-applied', muted },
      );
    },
    startAudio: async () => {
      try {
        await room.startAudio();
        playback();
      } catch {
        say({ type: 'playback-changed', allowed: false });
      }
    },
    /** Synchronous as far as local capture goes: nothing pending can delay it. */
    release: () => {
      released = true;
      releaseTracks();
      input.handles([]);
      void Promise.resolve(room.disconnect(true))
        .catch(() => undefined)
        .then(() => room.removeAllListeners());
    },
  };
}
