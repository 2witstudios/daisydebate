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

test('Room discovery fences searches and cursors by the selected lobby', async () => {
  await withDiscoveryFixture(async ({ f, caller, formatId, token, list }) => {
    const [adult] = await f.sql`
      select l.id from lobbies l join organizations o on o.id=l.owner_organization_id
       where o.official and l.kind='standing' and l.age_rule='adults'`;
    const [youth] = await f.sql`
      select l.id from lobbies l join organizations o on o.id=l.owner_organization_id
       where o.official and l.kind='standing' and l.age_rule='under-18'`;
    const correct = await f.room(caller.actorId, formatId, {
      lobby_id: youth!.id,
      topic: token,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    const wrong = await f.room(caller.actorId, formatId, {
      lobby_id: adult!.id,
      topic: token,
      created_at: new Date('2026-01-02T00:00:00.000Z'),
    });
    const options = { q: token, pageSize: 1 };
    const selected = await list({ ...options, lobbyId: youth!.id });
    const other = await list({ ...options, lobbyId: adult!.id });
    const wrongCursor = await list({
      ...options,
      lobbyId: youth!.id,
      cursor: wrong,
    });
    assert({
      given: 'public Rooms with matching topics in two official lobbies',
      should:
        'discover each Room exclusively in its own lobby and ignore a foreign cursor',
      actual: [selected, other, wrongCursor].map((page) => ({
        rooms: page.rooms.map(({ id }) => id),
        nextCursor: page.nextCursor,
        retry: page.retry,
      })),
      expected: [
        { rooms: [correct], nextCursor: null, retry: false },
        { rooms: [wrong], nextCursor: null, retry: false },
        { rooms: [], nextCursor: null, retry: false },
      ],
    });
  });
});

test('another official league appears while an ordinary league stays out of discovery', async () => {
  await withDiscoveryFixture(
    async ({ f, caller, formatId, token, list, nextId }) => {
      const seed = async (official: boolean) => {
        const leagueId = nextId();
        const lobbyId = nextId();
        await f.insert('organizations', {
          id: leagueId,
          name: leagueId,
          handle: leagueId,
          kind: 'league',
          owner_user_id: await f.user(),
          league_division: 'open',
          official,
        });
        await f.insert('lobbies', {
          id: lobbyId,
          name: lobbyId,
          handle: lobbyId,
          kind: 'standing',
          owner_organization_id: leagueId,
        });
        const roomId = await f.room(caller.actorId, formatId, {
          lobby_id: lobbyId,
          topic: token,
        });
        return { lobbyId, roomId };
      };
      const official = await seed(true);
      const ordinary = await seed(false);
      const discover = async (lobbyId: string) =>
        (await list({ q: token, pageSize: 1, lobbyId })).rooms.map(
          ({ id }) => id,
        );
      assert({
        given:
          'two additional leagues with public standing Rooms, one marked official',
        should:
          'include the official league by its lobby id and keep the ordinary league Room out of discovery',
        actual: [
          await discover(official.lobbyId),
          await discover(ordinary.lobbyId),
        ],
        expected: [[official.roomId], []],
      });
    },
  );
});
