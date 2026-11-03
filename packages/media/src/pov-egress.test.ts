import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  AudioCodec,
  EgressInfo,
  EgressStatus,
  ParticipantInfo,
  ServerError,
  TrackInfo,
  TrackSource,
  type EncodedOutputs,
  type ParticipantEgressOptions,
} from 'livekit-server-sdk';
import { createPovEgress } from './pov-egress';

setupRitewayBun();

const config = {
  url: 'https://livekit.test',
  apiKey: 'key',
  apiSecret: 'a-secret-long-enough-for-a-signing-key-000',
};

type Calls = {
  started: [
    string,
    string,
    EncodedOutputs,
    ParticipantEgressOptions | undefined,
  ][];
  updated: unknown[][];
};

const adapter = (
  over: {
    participants?: () => Promise<ParticipantInfo[]>;
    update?: () => Promise<never>;
  } = {},
) => {
  const calls: Calls = { started: [], updated: [] };
  const pov = createPovEgress({
    config,
    client: {
      startParticipantEgress: async (
        room: string,
        identity: string,
        output: EncodedOutputs,
        options?: ParticipantEgressOptions,
      ) => {
        calls.started.push([room, identity, output, options]);
        return new EgressInfo({ egressId: 'EG' });
      },
      stopEgress: async () => new EgressInfo(),
      listEgress: async () => [],
    } as never,
    rooms: {
      updateParticipant: async (...args: unknown[]) => {
        calls.updated.push(args);
        if (over.update) await over.update();
        return new ParticipantInfo();
      },
      listParticipants: over.participants ?? (async () => []),
    } as never,
  });
  return { pov, calls };
};

test('a POV Egress holds its output under its prefix, at 540p with AAC', async () => {
  const { pov, calls } = adapter();
  const id = await pov.start({
    room: 'room',
    identity: 'seat-identity',
    holdPrefix: 'recording-hold/r/pov/s/1/',
    segmentSeconds: 4,
  });
  const [room, identity, output, options] = calls.started[0]!;
  const encoding = options?.encodingOptions as {
    height: number;
    audioCodec: AudioCodec;
  };
  assert({
    given: 'a start',
    should: 'join by identity and write the attempt under its own prefix',
    actual: [
      id,
      room,
      identity,
      output.file?.filepath,
      output.segments?.filenamePrefix,
      output.segments?.playlistName,
      encoding.height,
      encoding.audioCodec,
    ],
    expected: [
      'EG',
      'room',
      'seat-identity',
      'recording-hold/r/pov/s/1/full.mp4',
      'recording-hold/r/pov/s/1/s',
      'p.m3u8',
      540,
      AudioCodec.AAC,
    ],
  });
});

test('revoking keeps the Egress hidden and a recorder', async () => {
  const { pov, calls } = adapter();
  await pov.revoke('room', 'EG');
  await pov.restore('room', 'EG');
  assert({
    given: 'a revocation and a restore',
    should: 'name the Egress by its id and change only subscribing',
    actual: calls.updated,
    expected: [false, true].map((canSubscribe) => [
      'room',
      'EG',
      undefined,
      {
        canSubscribe,
        canPublish: false,
        canPublishData: false,
        hidden: true,
        recorder: true,
      },
    ]),
  });
});

test('an Egress already gone from the room is revoked; another failure is not', async () => {
  const gone = adapter({
    update: async () => {
      throw new ServerError('gone', 'missing', 404);
    },
  });
  const broken = adapter({
    update: async () => {
      throw new Error('unreachable');
    },
  });
  assert({
    given: 'a 404, then another failure',
    should: 'confirm the first and let the second reach the caller',
    actual: [
      await gone.pov.revoke('room', 'EG'),
      await broken.pov
        .revoke('room', 'EG')
        .catch((error: Error) => error.message),
    ],
    expected: [undefined, 'unreachable'],
  });
});

test('participants say who is present and how tall a camera is', async () => {
  const { pov } = adapter({
    participants: async () => [
      new ParticipantInfo({
        identity: 'tall',
        tracks: [
          new TrackInfo({ source: TrackSource.MICROPHONE }),
          new TrackInfo({ source: TrackSource.CAMERA, height: 540 }),
        ],
      }),
      new ParticipantInfo({ identity: 'voice' }),
    ],
  });
  assert({
    given: 'one with a camera and one with none',
    should: 'report each',
    actual: await pov.participants('room'),
    expected: [
      { identity: 'tall', cameraHeight: 540 },
      { identity: 'voice', cameraHeight: null },
    ],
  });
});

test('a finished Egress is not running, and listRunning names only POV outputs', async () => {
  const pov = createPovEgress({
    config,
    client: {
      startParticipantEgress: async () => new EgressInfo(),
      stopEgress: async () => new EgressInfo(),
      listEgress: async () => [
        new EgressInfo({
          egressId: 'P',
          status: EgressStatus.EGRESS_ACTIVE,
          request: {
            case: 'participant',
            value: {
              segmentOutputs: [
                { filenamePrefix: 'recording-hold/r/pov/s/1/s' },
              ],
            } as never,
          },
        }),
        new EgressInfo({
          egressId: 'W',
          status: EgressStatus.EGRESS_ACTIVE,
          request: { case: 'web', value: {} as never },
        }),
      ],
    } as never,
    rooms: {} as never,
  });
  assert({
    given: 'a Participant Egress and a web Egress',
    should: 'list the first by its path',
    actual: await pov.listRunning(),
    expected: [{ egressId: 'P', path: 'recording-hold/r/pov/s/1/s' }],
  });
});
