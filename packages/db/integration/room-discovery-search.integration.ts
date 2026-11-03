import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withDiscoveryFixture } from './room-discovery.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('Lobby search finds a live Room by the resolution its row shows', async () =>
  withDiscoveryFixture(
    async ({ f, caller, formatId, token, nextId, config, list }) => {
      const roomId = nextId();
      const resolution = `Resolved ${token}`;
      await f.room(caller.actorId, formatId, {
        id: roomId,
        title: `Room ${nextId()}`,
        topic: 'A topic the draw replaced',
        status: 'started',
      });
      await f.round({
        room_id: roomId,
        format_id: formatId,
        resolution,
        room_config_snapshot: config,
        visibility: 'public',
        status: 'opening',
      });
      const answer = await list({
        q: resolution,
        pageSize: 5,
        sort: 'newest',
      });
      assert({
        given: 'a started Room whose Round stored a different resolution',
        should: 'return that Room for its resolution, showing the same text',
        actual: answer.rooms.map((room) => [room.id, room.topic]),
        expected: [[roomId, resolution]],
      });
    },
  ));
