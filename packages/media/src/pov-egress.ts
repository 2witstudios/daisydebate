import {
  AudioCodec,
  EgressClient,
  EncodedFileOutput,
  EncodingOptions,
  RoomServiceClient,
  SegmentedFileOutput,
  ServerError,
  TrackSource,
  VideoCodec,
  type ParticipantInfo,
} from 'livekit-server-sdk';
import { configSchema, parseMedia, type MediaConfig } from './contracts';
import { egressFact, type EgressFact } from './egress-fact';

/**
 * One debater's camera and voice as one file (REC-1.6): 540p whatever the camera
 * sends, so a layer dropping mid-Round never changes the file. AAC, so the kept audio
 * file is that stream, unchanged. The rates are ceilings, to be measured.
 */
const POV_ENCODING = new EncodingOptions({
  width: 960,
  height: 540,
  framerate: 25,
  videoBitrate: 800,
  videoCodec: VideoCodec.H264_MAIN,
  audioBitrate: 64,
  audioCodec: AudioCodec.AAC,
});

/** Hidden and a recorder whatever else changes: an update overwrites both. */
const egressPermission = (canSubscribe: boolean) => ({
  canSubscribe,
  canPublish: false,
  canPublishData: false,
  hidden: true,
  recorder: true,
});

const cameraHeightOf = (participant: ParticipantInfo): number | null => {
  const heights = participant.tracks.flatMap((track) =>
    track.source === TrackSource.CAMERA && !track.muted ? [track.height] : [],
  );
  return heights.length > 0 ? Math.max(...heights) : null;
};

const isGone = (error: unknown) =>
  error instanceof ServerError && error.status === 404;

/**
 * The Egress of one debater's POV. It joins by identity, so it follows every
 * republish, and it holds no credential of its own: LiveKit's default for an Egress
 * names it by its id. All credentials are injected, for whichever LiveKit holds the room.
 */
export function createPovEgress(deps: {
  readonly config: MediaConfig;
  readonly client?: Pick<
    EgressClient,
    'startParticipantEgress' | 'stopEgress' | 'listEgress'
  >;
  readonly rooms?: Pick<
    RoomServiceClient,
    'updateParticipant' | 'listParticipants'
  >;
}) {
  const { url, apiKey, apiSecret } = parseMedia(
    configSchema,
    deps.config,
    true,
  );
  const client = deps.client ?? new EgressClient(url, apiKey, apiSecret);
  const rooms = deps.rooms ?? new RoomServiceClient(url, apiKey, apiSecret);
  const setSubscribe = (room: string, egressId: string, on: boolean) =>
    rooms.updateParticipant(room, egressId, undefined, egressPermission(on));
  return {
    async start(input: {
      readonly room: string;
      readonly identity: string;
      readonly holdPrefix: string;
      readonly segmentSeconds: number;
    }) {
      const started = await client.startParticipantEgress(
        input.room,
        input.identity,
        {
          file: new EncodedFileOutput({
            filepath: `${input.holdPrefix}full.mp4`,
          }),
          segments: new SegmentedFileOutput({
            filenamePrefix: `${input.holdPrefix}s`,
            playlistName: 'p.m3u8',
            livePlaylistName: 'live.m3u8',
            segmentDuration: input.segmentSeconds,
          }),
        },
        { encodingOptions: POV_ENCODING },
      );
      return started.egressId;
    },
    async stop(id: string) {
      await client.stopEgress(id);
    },
    /** A job LiveKit no longer lists is reported failed, so it cannot look alive. */
    async read(id: string): Promise<EgressFact> {
      const [info] = await client.listEgress({ egressId: id });
      return info ? egressFact(info) : { kind: 'failed', id };
    },
    /** Every running POV Egress, whatever we recorded, with the path it writes under. */
    async listRunning() {
      const running = await client.listEgress({ active: true });
      return running.flatMap((info) => {
        if (info.request.case !== 'participant') return [];
        const path = info.request.value.segmentOutputs[0]?.filenamePrefix;
        return path ? [{ egressId: info.egressId, path }] : [];
      });
    },
    /** An Egress no longer in the room cannot receive anything: that is confirmed. */
    revoke: async (room: string, egressId: string) => {
      try {
        await setSubscribe(room, egressId, false);
      } catch (error) {
        if (!isGone(error)) throw error;
      }
    },
    restore: (room: string, egressId: string) =>
      setSubscribe(room, egressId, true),
    /** Who is in the room, with their camera's height. A room that has gone has nobody. */
    async participants(room: string) {
      try {
        const found = await rooms.listParticipants(room);
        return found.map((participant) => ({
          identity: participant.identity,
          cameraHeight: cameraHeightOf(participant),
        }));
      } catch (error) {
        if (isGone(error)) return [];
        throw error;
      }
    },
  };
}

export type PovEgress = ReturnType<typeof createPovEgress>;
