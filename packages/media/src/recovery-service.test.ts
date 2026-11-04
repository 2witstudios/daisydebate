import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaService } from './service';
import {
  ParticipantInfo,
  ServerError,
  TrackSource,
  type RoomServiceClient,
} from 'livekit-server-sdk';
setupRitewayBun();
test('recovery reads the exact room and projects scoped publication permissions', async () => {
  const room = 'r'.repeat(24),
    identity = 'i'.repeat(24);
  const calls: unknown[] = [];
  const service = createMediaService({
    config: {
      url: 'http://localhost:7880',
      apiKey: 'test',
      apiSecret: 'secret',
    },
    rooms: {
      listRooms: async (names?: string[]) => {
        calls.push(names);
        return [];
      },
      listParticipants: async () => [
        new ParticipantInfo({
          identity,
          permission: {
            canPublish: true,
            canPublishData: true,
            canPublishSources: [
              TrackSource.MICROPHONE,
              TrackSource.SCREEN_SHARE,
            ],
            canUpdateMetadata: true,
          },
        }),
      ],
    } as unknown as RoomServiceClient,
  });
  const absent = !(await service.exists(room));
  const [participant] = await service.publicationPermissions(room);
  assert({
    given: 'scoped provider recovery calls',
    should: 'query exactly one room',
    actual: [absent, calls],
    expected: [true, [[room]]],
  });
  assert({
    given: 'unsafe provider defaults or extra sources',
    should: 'project supported sources and require a strict replacement',
    actual: participant,
    expected: {
      identity,
      capture: false,
      microphoneTrack: null,
      grants: {
        publish: ['microphone'],
        subscribe: false,
        hidden: false,
        capture: false,
      },
      restricted: false,
    },
  });
});

for (const [status, code] of [
  [503, 'unavailable'],
  [408, 'deadline_exceeded'],
] as const)
  test(`a room stranded on a dead node is reclaimed, then deleted: ${status}`, async () => {
    const calls: string[] = [];
    let stranded = true;
    const service = createMediaService({
      config: {
        url: 'http://127.0.0.1:7880',
        apiKey: 'key',
        apiSecret: 'secret',
      },
      rooms: {
        createRoom: async () => {
          calls.push('create');
          stranded = false;
        },
        deleteRoom: async () => {
          calls.push('delete');
          if (stranded)
            throw new ServerError('no response', 'no response', status, code);
        },
      } as never,
    });
    await service.deleteRoom('r4nd0mr00mnam3r4nd0mr00m');
    assert({
      given: "LiveKit's answer for a room held by a dead node",
      should: 'move it to a live node, then delete it',
      actual: calls,
      expected: ['delete', 'create', 'delete'],
    });
  });

test('a room whose node is gone says so; another fault stays a fault', async () => {
  const answers = (failure: Error | null) =>
    createMediaService({
      config: {
        url: 'http://127.0.0.1:7880',
        apiKey: 'key',
        apiSecret: 'secret',
      },
      rooms: {
        updateRoomMetadata: async () => {
          if (failure) throw failure;
        },
      } as never,
    }).roomAnswers('r4nd0mr00mnam3r4nd0mr00m');
  const dead = new ServerError(
    'no response',
    'no response',
    503,
    'unavailable',
  );
  assert({
    given: 'a live room, and one LiveKit cannot reach',
    should: 'answer true, then false',
    actual: [await answers(null), await answers(dead)],
    expected: [true, false],
  });
  assert({
    given: 'a network failure',
    should: 'stay a fault, since it says nothing about the room',
    actual: await answers(new Error('reset')).catch((error) => error.code),
    expected: 'INFRASTRUCTURE',
  });
});
