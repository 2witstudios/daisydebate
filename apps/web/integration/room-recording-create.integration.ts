import { requireTestServices } from '@daisy/config';
import { roomViewSchema } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoomHttpFixture } from './room-http.test-support';
import { withSql } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();
const { f, routes, headers, member, command } = createRoomHttpFixture();

test('recording create HTTP binds the receipt to its payload and member and refuses missing entitlement atomically', async () => {
  const host = await member();
  const outsider = await member();
  const catalog = await routes.rooms.catalog(
    new Request(`${f.origin}/api/rooms/catalog`, { headers: headers(host) }),
  );
  const { resolutions } = await catalog.json();
  const body = {
    commandId: createId(),
    title: `Recording ${createId()}`,
    resolution: {
      kind: 'value',
      id: resolutions.find((r: { kind: string }) => r.kind === 'value').id,
    },
    visibility: 'unlisted',
    recording: true,
    selection: {
      kind: 'catalog',
      formatId: 'value',
      formatVersion: 1,
      presetVersion: 1,
      competitionType: 'casual',
    },
  };
  const post = (cookie: string, input = body) =>
    routes.rooms.create(f.jsonPost('/api/rooms', input, { cookie }));
  let roomId: string | undefined;
  try {
    const created = await post(host);
    const answer = await created.json();
    const view = roomViewSchema.parse(answer.view);
    roomId = view.id;
    await withSql(
      (sql) =>
        sql`delete from account_entitlement_grants where entitlement='casual_capture' and user_id in (select a.user_id from actors a join rooms r on r.host_actor_id=a.id where r.id=${roomId!})`,
    );
    const replay = await post(host);
    const replayed = await replay.json();
    const changed = await post(host, { ...body, recording: false });
    const stolen = await post(outsider);
    assert({
      given:
        'a recorded create, then grant removal, exact replay, changed payload and another member',
      should:
        'retain recording on exact replay while refusing changed or stolen receipt identities',
      actual: [
        created.status,
        view.capture,
        replay.status,
        replayed.receipt.replayed,
        replayed.view.capture,
        changed.status,
        stolen.status,
      ],
      expected: [
        201,
        { broadcast: null, recording: true },
        201,
        true,
        { broadcast: null, recording: true },
        409,
        409,
      ],
    });
    await command(host, view, { type: 'close' });
    const refusedId = createId();
    const refused = await post(host, { ...body, commandId: refusedId });
    const rows = await withSql(async (sql) => {
      const [row] =
        await sql`select (select count(*)::int from rooms where title=${body.title}) rooms, (select count(*)::int from room_commands where command_id=${refusedId}) receipts, (select count(*)::int from room_active_memberships where room_id=${roomId!}) members`;
      return row;
    });
    assert({
      given: 'a crafted recording POST after the host lost their grant',
      should:
        'refuse by name without a partial Room, receipt or active membership',
      actual: [refused.status, (await refused.json()).refusal, rows],
      expected: [409, 'capture-premium', { rooms: 1, receipts: 0, members: 0 }],
    });
    const ranked = {
      ...body,
      commandId: createId(),
      recording: false,
      visibility: 'public',
      selection: {
        kind: 'ranked',
        formatId: 'value',
        formatVersion: 1,
        presetVersion: 1,
      },
    };
    assert({
      given: 'a forged recording opt-out for ranked creation',
      should: 'refuse the override at the HTTP boundary',
      actual: (
        await routes.rooms.create(
          f.jsonPost('/api/rooms', ranked, { cookie: host }),
        )
      ).status,
      expected: 400,
    });
  } finally {
    if (roomId)
      await withSql(async (sql) => {
        await sql`delete from outbox where topic=${`room:${roomId}`}`;
        await sql`delete from rooms where id=${roomId}`;
      });
  }
});
