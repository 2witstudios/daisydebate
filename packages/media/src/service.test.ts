import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  ParticipantInfo,
  Room,
  type RoomServiceClient,
  TrackSource,
} from 'livekit-server-sdk';
import { createMediaService } from './index';
setupRitewayBun();
const config = {
  url: 'http://127.0.0.1:7880',
  apiKey: 'test-key',
  apiSecret: 'test-secret',
};
const room = 'r'.repeat(24);
const identity = 'i'.repeat(24);

describe('media room service boundary', () => {
  test('existing rooms are unchanged, permissions are explicit and teardown is scoped', async () => {
    const calls: unknown[] = [];
    let exists = false;
    const rooms = {
      listRooms: async (names?: string[]) => {
        calls.push(['list', names]);
        return exists ? [new Room({ name: room })] : [];
      },
      createRoom: async (input: { name: string }) => {
        calls.push(['create', input]);
        exists = true;
        return new Room(input);
      },
      deleteRoom: async (name: string) => {
        calls.push(['delete', name]);
      },
      updateParticipant: async (...args: unknown[]) => {
        calls.push(['update', ...args]);
        return new ParticipantInfo({ identity });
      },
      listParticipants: async () => [
        new ParticipantInfo({
          identity,
          name: 'private display name',
          metadata: 'private metadata',
          permission: {
            canPublish: true,
            canSubscribe: true,
            canPublishSources: [TrackSource.MICROPHONE],
          },
        }),
      ],
    } as unknown as Pick<
      RoomServiceClient,
      | 'listRooms'
      | 'createRoom'
      | 'deleteRoom'
      | 'updateParticipant'
      | 'listParticipants'
    >;
    const service = createMediaService({ config, rooms });
    await service.createRoom(room);
    await service.createRoom(room);
    await service.permissions(room, identity, {
      publish: ['microphone'],
      subscribe: true,
      capture: false,
    });
    const participants = await service.participants(room);
    await service.deleteRoom(room);
    assert({
      given: 'repeated creation and a participant grant update',
      should: 'create once and set the full permission vector without metadata',
      actual: calls,
      expected: [
        ['list', [room]],
        ['create', { name: room }],
        ['list', [room]],
        [
          'update',
          room,
          identity,
          {
            permission: {
              canPublish: true,
              canSubscribe: true,
              canPublishData: false,
              canPublishSources: [TrackSource.MICROPHONE],
              canUpdateMetadata: false,
              hidden: false,
            },
            name: '',
          },
        ],
        ['delete', room],
      ],
    });
    assert({
      given: 'a vendor participant with personal metadata',
      should: 'return only its identity and permissions',
      actual: Object.keys(participants[0]!),
      expected: ['identity', 'permission'],
    });
  });

  test('vendor failures expose no credentials or raw exception', async () => {
    const rooms = {
      deleteRoom: async () => {
        throw new Error('test-secret token raw vendor body');
      },
    } as unknown as RoomServiceClient;
    try {
      await createMediaService({ config, rooms }).deleteRoom(room);
    } catch (error) {
      assert({
        given: 'a vendor exception containing private details',
        should: 'return only a safe infrastructure failure without cause',
        actual: [(error as Error).message, (error as Error).cause],
        expected: ['Media service operation failed', undefined],
      });
      return;
    }
    throw new Error('Expected media service failure');
  });

  test('invalid identifiers and extra privilege claims refuse before I/O', async () => {
    const service = createMediaService({
      config,
      rooms: {} as RoomServiceClient,
    });
    await assertRejects({
      given: 'an invalid room identity',
      should: 'refuse before room service access',
      actual: () => service.deleteRoom('unsafe-room'),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'an additional administrator grant',
      should: 'refuse instead of forwarding unknown privileges',
      actual: () =>
        service.joinToken({
          room,
          identity,
          publish: [],
          subscribe: true,
          capture: false,
          roomAdmin: true,
        } as never),
      code: 'VALIDATION',
    });
  });

  test('malformed vendor participant identities refuse instead of escaping the boundary', async () => {
    const rooms = {
      listParticipants: async () => [new ParticipantInfo({ identity: '' })],
    } as unknown as RoomServiceClient;
    await assertRejects({
      given: 'a malformed participant from the service',
      should: 'fail as infrastructure instead of returning invalid state',
      actual: () => createMediaService({ config, rooms }).participants(room),
      code: 'INFRASTRUCTURE',
    });
  });
});
