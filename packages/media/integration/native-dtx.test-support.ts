import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import { createId } from '@paralleldrive/cuid2';
import { createMediaService } from '../src/service';
import { config } from './native-room.test-support';

/** Bounded publisher metadata only; no SDP, identities, source credit or hearing. */
async function publisherObservation(track: LocalAudioTrack) {
  try {
    const stats = await track.getStats({ timeoutMs: 1000 });
    const senders = stats.flatMap(({ stats: value }) => {
      if (value.case !== 'outboundRtp' || value.value.stream?.kind !== 'audio')
        return [];
      const codecId = value.value.stream.codecId;
      const row = stats.find(
        ({ stats }) =>
          stats.case === 'codec' && stats.value.rtc?.id === codecId,
      )?.stats;
      const codec = row?.case === 'codec' ? row.value.codec : undefined;
      const usedtx = codec?.sdpFmtpLine
        ?.split(';')
        .map((part) => part.trim().split('='))
        .find(([key]) => key === 'usedtx')?.[1];
      return [
        {
          packetsSent: value.value.sent?.packetsSent?.toString() ?? null,
          codec: codec
            ? {
                mimeType: codec.mimeType ?? null,
                clockRate: codec.clockRate ?? null,
                channels: codec.channels ?? null,
                fmtpAvailable: typeof codec.sdpFmtpLine === 'string',
                usedtx:
                  usedtx === '0' || usedtx === '1'
                    ? usedtx
                    : usedtx === undefined
                      ? null
                      : 'unrecognized',
              }
            : null,
        },
      ];
    });
    return {
      kind: 'observed' as const,
      outboundCount: senders.length,
      senders: senders.slice(0, 4),
    };
  } catch {
    return { kind: 'unknown' as const, reason: 'stats-unavailable' as const };
  }
}
/** Synthetic source with an explicit DTX choice; defaults to the original positive. */
export async function withDtxSource<Result>(
  work: (input: {
    roomName: string;
    identity: string;
    send: (pcm: Int16Array) => Promise<void>;
    sent: () => number;
    publisher: {
      readonly requestedDtx: boolean | null;
      readonly snapshot: () => ReturnType<typeof publisherObservation>;
    };
  }) => Promise<Result>,
  requestedDtx = true,
): Promise<Result> {
  const service = createMediaService({ config }),
    roomName = createId(),
    identity = createId();
  await service.createRoom(roomName);
  const room = new Room(),
    source = new AudioSource(48000, 1, 0),
    track = LocalAudioTrack.createAudioTrack(createId(), source);
  let samples = 0;
  try {
    await room.connect(
      'ws://127.0.0.1:7880',
      await service.joinToken({
        room: roomName,
        identity,
        publish: ['microphone'],
        subscribe: false,
        capture: false,
      }),
      { autoSubscribe: false, dynacast: false },
    );
    if (!room.localParticipant) throw new Error('Missing fixture publisher');
    const options = new TrackPublishOptions({
      source: TrackSource.SOURCE_MICROPHONE,
      dtx: requestedDtx,
      red: false,
    });
    await room.localParticipant.publishTrack(track, options);
    return await work({
      roomName,
      identity,
      sent: () => samples,
      publisher: {
        requestedDtx: options.dtx ?? null,
        snapshot: () => publisherObservation(track),
      },
      send: async (pcm) => {
        if (pcm.length !== 480) throw new Error('Invalid fixture frame');
        await source.captureFrame(new AudioFrame(pcm, 48000, 1, 480));
        samples += 480;
      },
    });
  } finally {
    try {
      await track.close();
    } finally {
      try {
        await room.disconnect();
      } finally {
        if (await service.exists(roomName)) await service.deleteRoom(roomName);
      }
    }
  }
}
