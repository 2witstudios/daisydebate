import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaService } from './service';
import {
  ParticipantInfo,
  TrackSource,
  type RoomServiceClient,
} from 'livekit-server-sdk';
setupRitewayBun();
test('recovery reads exact room and removes only the scoped competitive identity', async () => {
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
      removeParticipant: async (...args: unknown[]) => {
        calls.push(args);
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
  await service.remove(room, identity);
  const [participant] = await service.publicationPermissions(room);
  assert({
    given: 'scoped provider recovery calls',
    should: 'query one room and remove one identity',
    actual: [absent, calls],
    expected: [true, [[room], [room, identity]]],
  });
  assert({
    given: 'unsafe provider defaults or extra sources',
    should: 'project supported sources and require a strict replacement',
    actual: participant,
    expected: {
      identity,
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
