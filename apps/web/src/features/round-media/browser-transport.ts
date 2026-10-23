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
  readonly track: Track;
};

/** The SDK surface this transport uses: livekit-client in the browser, a stub in tests. */
type MediaSdk = {
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

/** Browser SDK only. Opaque identities stay in memory; no SDK diagnostics reach console. */
export function createBrowserMediaTransport(
  events: {
    readonly tracks: (tracks: readonly MediaTrack[]) => void;
    readonly invalidated: () => void;
    readonly reconnect: () => void;
  },
  sdk: MediaSdk = livekit,
) {
  setLogLevel(LogLevel.silent);
  const room = sdk.room();
  let stopped = false;
  const tracks = new Map<'camera' | 'microphone', LocalTrack>();
  const emit = () => {
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
        if (source && publication.track && !publication.isMuted)
          snapshot.push({
            identity: participant.identity,
            source,
            local: participant === room.localParticipant,
            speaking: participant.isSpeaking,
            track: publication.track,
          });
      }
    events.tracks(snapshot);
  };
  const stopTracks = () => {
    stopped = true;
    for (const track of tracks.values()) track.stop();
    tracks.clear();
    events.tracks([]);
  };
  room
    .on(RoomEvent.TrackSubscribed, emit)
    .on(RoomEvent.TrackUnsubscribed, emit)
    .on(RoomEvent.TrackMuted, emit)
    .on(RoomEvent.TrackUnmuted, emit)
    .on(RoomEvent.LocalTrackPublished, emit)
    .on(RoomEvent.LocalTrackUnpublished, emit)
    .on(RoomEvent.ActiveSpeakersChanged, emit);
  room
    .on(RoomEvent.Connected, events.invalidated)
    .on(RoomEvent.ParticipantConnected, events.invalidated)
    .on(RoomEvent.ParticipantDisconnected, events.invalidated)
    .on(RoomEvent.ParticipantPermissionsChanged, events.invalidated);
  room.on(RoomEvent.Disconnected, () => {
    if (!stopped) {
      stopTracks();
      events.reconnect();
    }
  });
  const publishSource = async (source: 'camera' | 'microphone') => {
    const captured = await sdk.capture({
      audio: source === 'microphone',
      video:
        source === 'camera'
          ? { resolution: VideoPresets.h360.resolution }
          : false,
    });
    for (const track of captured) {
      if (stopped) {
        track.stop();
        continue;
      }
      tracks.set(source, track);
      try {
        await room.localParticipant.publishTrack(track, {
          source:
            source === 'camera' ? Track.Source.Camera : Track.Source.Microphone,
        });
      } catch (error) {
        track.stop();
        tracks.delete(source);
        throw error;
      }
      if (stopped) track.stop();
    }
  };
  let work = Promise.resolve();
  const apply = (state: RoundMediaState) => {
    work = work.then(async () => {
      if (stopped) return;
      for (const [source, track] of tracks)
        if (!state.grants.publish.includes(source)) {
          tracks.delete(source);
          track.stop();
          await room.localParticipant.unpublishTrack(track, true);
        }
      for (const source of state.grants.publish) {
        if (!stopped && !tracks.has(source)) await publishSource(source);
      }
      if (!stopped) emit();
    });
    return work;
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
  return { transport, startAudio: () => room.startAudio() };
}
