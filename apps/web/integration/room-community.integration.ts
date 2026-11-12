import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import {
  buildRoundTopic,
  isNamedSeat,
  roomViewSchema,
  type RoomView,
} from '@daisy/protocol';
import {
  oneOnOneDefinition,
  oneOnOneRankedSettings,
} from '@daisy/db/reference-formats';
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

/** Removes a Room this suite made, with its chat, reports, Round and format. */
const removeRoom = (roomId: string) =>
  withSql(async (sql) => {
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

    const endInstant = () =>
      withSql(
        async (sql) =>
          (await sql`select updated_at from rooms where id=${room}`)[0]
            .updated_at as Date,
      );
    const endedAt = await endInstant();
    const lateCommands = await Promise.all(
      (
        [
          [host, { type: 'close' }],
          [host, { type: 'start-round' }],
          [visitor, { type: 'claim-seat', role: 'negative', slot: 0 }],
        ] as const
      ).map(async ([cookie, body]) => {
        const response = await h.routes.rooms.commands(
          h.f.jsonPost(
            `/api/rooms/${room}/commands`,
            { ...body, commandId: createId(), expectedVersion: view.version },
            { cookie },
          ),
          room,
        );
        return response.status === 200;
      }),
    );
    assert({
      given: 'Room commands sent after the Room started',
      should:
        'accept none and leave the Room’s last write, which Room chat reads as its end, where Start put it',
      actual: [
        lateCommands,
        (await endInstant()).getTime() === endedAt.getTime(),
      ],
      expected: [[false, false, false], true],
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
    if (roomId) await removeRoom(roomId);
  }
});

/** A casual Room with one human judge seat, as a custom format. */
const judgedSelection = {
  kind: 'custom',
  definition: {
    ...oneOnOneDefinition,
    seats: { ...oneOnOneDefinition.seats, judge: 1 },
  },
  competitionType: 'casual',
  config: {
    ...oneOnOneRankedSettings,
    preRoundPrep: { enabled: false },
    resolutionDraw: { enabled: false },
  },
} as const;

for (const hostSeat of ['affirmative', 'judge'] as const)
  test(`a human judge of a private casual Room reads its chat and cannot post, and nothing names them to a debater (host seated as ${hostSeat})`, async () => {
    const host = await h.member(),
      second = await h.member(),
      third = await h.member();
    // The judge is the host or the third member; the others debate.
    const judge = hostSeat === 'judge' ? host : third;
    const debater = hostSeat === 'judge' ? third : host;
    const reader = second;
    let roomId: string | null = null;
    try {
      const created = await h.routes.rooms.create(
        h.f.jsonPost(
          '/api/rooms',
          {
            commandId: createId(),
            title: 'Judge reads Room chat',
            resolution: { kind: 'custom', text: 'Cities should fund transit' },
            visibility: 'unlisted',
            selection: judgedSelection,
          },
          { cookie: host },
        ),
      );
      let view: RoomView = roomViewSchema.parse((await created.json()).view);
      const room = (roomId = view.id);
      for (const [cookie, role] of [
        [debater, 'affirmative'],
        [reader, 'negative'],
        [judge, 'judge'],
      ] as const)
        view = await h.command(cookie, view, {
          type: 'claim-seat',
          role,
          slot: 0,
        });
      await withSql(
        (sql) =>
          sql`update rooms set visibility='private',version=version+1 where id=${room}`,
      );
      const path = `/api/rooms/${room}/chat`;
      const post = (cookie: string, kind: Kind, body: object) =>
        h.routes.roomCommunity[kind](
          h.f.jsonPost(path + segment[kind], body, { cookie }),
          room,
        );
      const discover = async (cookie: string) =>
        (
          await h.routes.roomCommunity.discover(
            new Request(h.f.origin + path, { headers: h.headers(cookie) }),
            room,
          )
        ).json();
      const stored = () =>
        withSql(async (sql) =>
          JSON.stringify(
            await sql`select c.id,s.message_sequence,s.change_version,(select count(*)::int from messaging_messages m where m.channel_id=c.id) as messages from messaging_channels c join messaging_channel_streams s on s.channel_id=c.id where c.room_id=${room}`,
          ),
        );

      const unopened = await discover(judge);
      const judgeOpen = await post(judge, 'open', { version: 1, roomId: room });
      assert({
        given: 'a judge in a Room whose chat nobody has opened',
        should: 'find no channel, be refused the open and create nothing',
        actual: [unopened.channel, judgeOpen.status, await stored()],
        expected: [null, 403, '[]'],
      });

      const opened = await (
        await post(debater, 'open', { version: 1, roomId: room })
      ).json();
      const channelId = opened.channelId as string;
      const sent = await post(debater, 'send', {
        version: 1,
        channelId,
        requestId: createId(),
        text: 'Debater says hello',
      });
      const message = await sent.json();
      const before = await stored();
      const read = (cookie: string) =>
        h.routes.roomCommunity.history(
          new Request(`${h.f.origin}${path}/messages?channelId=${channelId}`, {
            headers: h.headers(cookie),
          }),
          room,
        );
      const judgeRead = await read(judge);
      const judgePage = await judgeRead.json();
      const judgeSend = await post(judge, 'send', {
        version: 1,
        channelId,
        requestId: createId(),
        text: 'Judge says hello',
      });
      const judgeEdit = await post(judge, 'edit', {
        version: 1,
        channelId,
        requestId: createId(),
        messageId: message.id,
        text: 'Judge rewrites',
      });
      assert({
        given:
          'the judge reading the opened chat, then posting and editing in it',
        should:
          'read the debater’s message in a read-only chat, be refused the post as forbidden and leave every stored row as it was',
        actual: [
          opened.readOnly,
          (await discover(judge)).channel?.readOnly,
          (
            await (
              await post(judge, 'open', { version: 1, roomId: room })
            ).json()
          ).readOnly,
          judgeRead.status,
          judgePage.metadata.readOnly,
          judgePage.history.messages.map((m: { text: string }) => m.text),
          judgeSend.status,
          judgeEdit.status === 200,
          (await stored()) === before,
        ],
        expected: [
          false,
          true,
          true,
          200,
          true,
          ['Debater says hello'],
          403,
          false,
          true,
        ],
      });

      const judgeIdentity = await createAccountFlows(h.f).identifyAs(judge);
      if (
        judgeIdentity.state !== 'member' ||
        judgeIdentity.principal.kind !== 'user'
      )
        throw Error('Expected a member judge');
      const readerRead = await read(reader);
      const wire = JSON.stringify([
        await readerRead.json(),
        await discover(reader),
      ]);
      assert({
        given: 'the other debater reading the same chat',
        should:
          'read a writable chat whose every author is a debater, with no standing, seat or role and neither the judge’s actor nor their username on the wire',
        actual: [
          readerRead.status,
          wire.includes('"readOnly":false'),
          wire.includes('"readOnly":true'),
          wire.includes(judgeIdentity.principal.actorId),
          wire.includes(judgeIdentity.username),
          /seated|visitor|standing|judge|affirmative|negative|seatRole|"host"/.test(
            wire,
          ),
        ],
        expected: [200, true, false, false, false, false],
      });
    } finally {
      if (roomId) await removeRoom(roomId);
    }
  });
