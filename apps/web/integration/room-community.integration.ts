import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import {
  buildRoundTopic,
  isNamedSeat,
  roomViewSchema,
  type RoomView,
} from '@daisy/protocol';
import { createRoomHttpFixture } from './room-http.test-support';
import { foundationSelection } from './foundation-selection.test-support';
import { withSql } from './fixtures';
import { createAccountFlows } from './auth-account-helpers';

setupRitewayBun();
const h = createRoomHttpFixture();
type Kind = 'open' | 'send' | 'edit' | 'remove' | 'markRead' | 'report';
const segment: Record<Kind, string> = {
  open: '',
  send: '/messages',
  edit: '/edit',
  remove: '/remove',
  markRead: '/read',
  report: '/report',
};

test('real Room chat HTTP admits the host, seats and visitors of an open Room, never creates on a read, and ends for everyone at Start (RCHAT-3..8)', async () => {
  const host = await h.member(),
    guest = await h.member(),
    visitor = await h.member();
  let roomId: string | null = null;
  try {
    const created = await h.routes.rooms.create(
      h.f.jsonPost(
        '/api/rooms',
        {
          commandId: createId(),
          title: 'Room chat proof',
          resolution: { kind: 'custom', text: 'Cities should fund transit' },
          visibility: 'unlisted',
          selection: foundationSelection,
        },
        { cookie: host },
      ),
    );
    let view: RoomView = roomViewSchema.parse((await created.json()).view);
    const room = (roomId = view.id);
    const path = `/api/rooms/${room}/chat`;
    const post = (cookie: string | null, kind: Kind, body: object) =>
      h.routes.roomCommunity[kind](
        h.f.jsonPost(path + segment[kind], body, cookie ? { cookie } : {}),
        room,
      );
    const discover = (cookie: string | null) =>
      h.routes.roomCommunity.discover(
        new Request(
          h.f.origin + path,
          cookie ? { headers: h.headers(cookie) } : {},
        ),
        room,
      );
    const channels = () =>
      withSql(
        async (sql) =>
          (
            await sql`select count(*)::int as n from messaging_channels where room_id=${room}`
          )[0].n as number,
      );
    view = await h.command(host, view, {
      type: 'claim-seat',
      role: 'affirmative',
      slot: 0,
    });
    view = await h.command(guest, view, {
      type: 'claim-seat',
      role: 'negative',
      slot: 0,
    });

    const found = await discover(host);
    const visitorFound = await discover(visitor);
    assert({
      given: 'a gathering Room before anyone has used its chat',
      should:
        'answer discovery for a seat and a visitor with no channel, and create none',
      actual: [
        found.status,
        await found.json(),
        visitorFound.status,
        (await discover(null)).status,
        await channels(),
      ],
      expected: [200, { version: 1, roomId: room, channel: null }, 200, 401, 0],
    });

    const foreign = await h.routes.roomCommunity.open(
      new Request(h.f.origin + path, {
        method: 'POST',
        headers: {
          cookie: host,
          origin: 'https://foreign.invalid',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ version: 1, roomId: room }),
      }),
      room,
    );
    const otherRoom = await post(host, 'open', {
      version: 1,
      roomId: createId(),
    });
    assert({
      given:
        'an open from a foreign origin, and one whose body names another Room',
      should: 'refuse both and still create nothing',
      actual: [foreign.status, otherRoom.status, await channels()],
      expected: [403, 400, 0],
    });

    const [firstOpen, secondOpen] = await Promise.all([
      post(host, 'open', { version: 1, roomId: room }),
      post(visitor, 'open', { version: 1, roomId: room }),
    ]);
    const metadata = await firstOpen.json();
    const second = await secondOpen.json();
    assert({
      given: 'a seat and a visitor opening the same Room chat at once',
      should: 'receive one durable writable channel',
      actual: [
        firstOpen.status,
        secondOpen.status,
        metadata.channelId === second.channelId,
        metadata,
        await channels(),
      ],
      expected: [
        200,
        200,
        true,
        {
          version: 1,
          roomId: room,
          channelId: metadata.channelId,
          readOnly: false,
          expiresAt: null,
        },
        1,
      ],
    });
    const channelId = metadata.channelId as string;
    const command = {
      version: 1,
      channelId,
      requestId: createId(),
      text: 'Host says hello',
    };
    const sent = await post(host, 'send', command);
    const message = await sent.json();
    const repeated = await post(host, 'send', command);
    const visitorSent = await post(visitor, 'send', {
      ...command,
      requestId: createId(),
      text: 'Visitor says hello',
    });
    const visitorMessage = await visitorSent.json();
    const conflict = await post(host, 'send', {
      ...command,
      text: 'Conflicting reuse',
    });
    assert({
      given:
        'an accepted command, its retry, a visitor’s message and the same request identity with other text',
      should:
        'send each message once, keep the retry’s identity and refuse the conflicting reuse',
      actual: [
        sent.status,
        repeated.status,
        (await repeated.json()).id,
        visitorSent.status,
        conflict.status,
      ],
      expected: [200, 200, message.id, 200, 409],
    });

    const read = (cookie: string, query = '') =>
      h.routes.roomCommunity.history(
        new Request(
          `${h.f.origin}${path}/messages?channelId=${channelId}${query}`,
          { headers: h.headers(cookie) },
        ),
        room,
      );
    const guestRead = await read(guest);
    const page = await guestRead.json();
    const identities = await Promise.all(
      [host, visitor].map((cookie) =>
        createAccountFlows(h.f).identifyAs(cookie),
      ),
    );
    const labels = identities.map((identity) =>
      identity.state === 'member' ? identity.username : null,
    );
    assert({
      given: 'the other seat reading current history',
      should:
        'read both messages with their authors’ usernames, the Room’s metadata, the realtime address header and no standing, seat or role',
      actual: [
        guestRead.status,
        page.roomId,
        page.metadata,
        page.history.messages.map((m: { text: string }) => m.text),
        page.authors.map((a: { label: string }) => a.label).sort(),
        /seated|visitor|standing|judge|affirmative|negative/.test(
          JSON.stringify(page),
        ),
        guestRead.headers.get('x-messaging-message-units') !== null,
      ],
      expected: [
        200,
        room,
        metadata,
        ['Visitor says hello', 'Host says hello'],
        [...labels].sort(),
        false,
        true,
      ],
    });

    const older = await read(visitor, '&limit=1&before=2');
    const marked = await post(visitor, 'markRead', {
      version: 1,
      channelId,
      cursor: { channelId, sequence: 2 },
    });
    assert({
      given: 'a visitor’s bound older-page cursor and read marker',
      should: 'read only the earlier message and persist the caller’s cursor',
      actual: [
        (await older.json()).history.messages.map((m: { id: string }) => m.id),
        marked.status,
        (await (await read(visitor)).json()).history.viewer.readSequence,
        (await (await read(guest)).json()).history.viewer.readSequence,
      ],
      expected: [[message.id], 200, 2, 0],
    });

    const report = (cookie: string, reason: string) =>
      post(cookie, 'report', {
        version: 1,
        channelId,
        messageId: message.id,
        reason,
      });
    const reported = await report(visitor, 'harassment');
    const selfReport = await report(host, 'harassment');
    const openReason = await report(guest, 'I did not like it');
    const stored = await withSql(
      (sql) =>
        sql`select target_kind,reason from content_reports where target_id=${message.id}`,
    );
    assert({
      given:
        'a visitor’s report of a seat’s message, a self report and a reason outside the closed set',
      should: 'accept only the peer report, with a chat-message reason',
      actual: [
        reported.status,
        selfReport.status,
        openReason.status,
        stored.map((row: { target_kind: string; reason: string }) => [
          row.target_kind,
          row.reason,
        ]),
      ],
      expected: [200, 404, 400, [['chat_message', 'harassment']]],
    });
    await withSql(async (sql) => {
      await sql`delete from content_reports where target_id=${message.id}`;
    });

    const edited = await post(host, 'edit', {
      version: 1,
      channelId,
      requestId: createId(),
      messageId: message.id,
      text: 'Host corrected',
    });
    const foreignEdit = await post(visitor, 'edit', {
      version: 1,
      channelId,
      requestId: createId(),
      messageId: message.id,
      text: 'Not mine to edit',
    });
    const foreignRemove = await post(visitor, 'remove', {
      version: 1,
      channelId,
      requestId: createId(),
      messageId: message.id,
    });
    const replaySend = await post(host, 'send', command);
    assert({
      given:
        'an author’s edit, another member’s edit and removal of that message, and the original send retried',
      should:
        'apply only the author’s change and answer the retry with the current text',
      actual: [
        edited.status,
        foreignEdit.status === 200,
        foreignRemove.status === 200,
        (await replaySend.json()).text,
      ],
      expected: [200, false, false, 'Host corrected'],
    });

    await withSql(
      (sql) =>
        sql`update rooms set visibility='private',version=version+1 where id=${room}`,
    );
    const hidden = [
      (await read(visitor)).status,
      (await discover(visitor)).status,
      (
        await post(visitor, 'send', {
          ...command,
          requestId: createId(),
          text: 'After private',
        })
      ).status,
      (await read(guest)).status,
    ];
    await withSql(
      (sql) =>
        sql`update rooms set visibility='unlisted',version=version+1 where id=${room}`,
    );
    assert({
      given: 'the Room made private while a visitor has the chat open',
      should:
        'treat the chat as missing for the visitor, their post included, and keep the seats’ access',
      actual: hidden,
      expected: [404, 404, 404, 200],
    });

    const current = async (cookie: string) =>
      roomViewSchema.parse(
        await (
          await h.routes.rooms.read(
            new Request(`${h.f.origin}/api/rooms/${room}`, {
              headers: h.headers(cookie),
            }),
            room,
          )
        ).json(),
      );
    for (const cookie of [host, guest]) {
      const own = await current(cookie);
      const identity = await createAccountFlows(h.f).identifyAs(cookie);
      const actorId =
        identity.principal.kind === 'user' ? identity.principal.actorId : null;
      const seat = own.participants
        .filter(isNamedSeat)
        .find((p) => p.actorId === actorId);
      if (!seat) throw Error('Expected own seat');
      view = await h.command(cookie, own, {
        type: 'ready',
        expectedConsentVersion: seat.consentVersion,
      });
    }
    view = await h.command(host, await current(host), { type: 'start-round' });
    const after = await Promise.all(
      [host, guest, visitor].map(async (cookie) => [
        (await read(cookie)).status,
        (await discover(cookie)).status,
        (
          await post(cookie, 'send', {
            ...command,
            requestId: createId(),
            text: 'After start',
          })
        ).status,
        (await post(cookie, 'open', { version: 1, roomId: room })).status,
      ]),
    );
    assert({
      given: 'the Room started',
      should:
        'treat the chat as missing for the host, the other seat and the visitor at once, for reads, posts and opens alike',
      actual: [view.status, after],
      expected: [
        'started',
        [
          [404, 404, 404, 404],
          [404, 404, 404, 404],
          [404, 404, 404, 404],
        ],
      ],
    });

    const removal = {
      version: 1,
      channelId,
      messageId: visitorMessage.id,
      requestId: createId(),
    };
    const removed = await post(visitor, 'remove', removal);
    const retried = await post(visitor, 'remove', removal);
    const lateEdit = await post(visitor, 'edit', {
      ...removal,
      requestId: createId(),
      text: 'Too late',
    });
    const texts = await withSql(
      (sql) =>
        sql`select text from messaging_messages where channel_id=${channelId} order by sequence`,
    );
    assert({
      given: 'the visitor withdrawing their own message after the Room started',
      should:
        'remove it, acknowledge the exact retry, refuse an edit and leave the other message stored for reports',
      actual: [
        removed.status,
        retried.status,
        lateEdit.status,
        texts.map((row: { text: string | null }) => row.text),
      ],
      expected: [200, 200, 404, ['Host corrected', null]],
    });
  } finally {
    if (roomId)
      await withSql(async (sql) => {
        await sql`delete from content_reports where target_id in (select m.id from messaging_messages m join messaging_channels c on c.id=m.channel_id where c.room_id=${roomId})`;
        await sql`delete from messaging_channels where room_id=${roomId}`;
        const [round] = await sql<{ id: string }[]>`
          select id from rounds where room_id=${roomId}
        `;
        if (round)
          await sql`delete from outbox where topic=${buildRoundTopic(round.id)}`;
        await sql`delete from round_participants where round_id in (select id from rounds where room_id=${roomId})`;
        await sql`delete from rounds where room_id=${roomId}`;
        await sql`delete from room_commands where room_id=${roomId}`;
        await sql`delete from room_participants where room_id=${roomId}`;
        await sql`delete from outbox where topic=${`room:${roomId}`}`;
        const [stored] = await sql<{ format_id: string }[]>`
          select format_id from rooms where id=${roomId}
        `;
        await sql`delete from rooms where id=${roomId}`;
        if (stored) {
          await sql`delete from formats where id=${stored.format_id}`;
          await sql`delete from format_revisions where format_id=${stored.format_id}`;
        }
      });
  }
});
