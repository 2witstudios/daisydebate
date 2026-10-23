import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaService } from './service';
import {
  ParticipantInfo,
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
