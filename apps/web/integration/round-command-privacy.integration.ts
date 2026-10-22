import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  isNamedSeat,
  roomViewSchema,
  roundViewSchema,
  buildDebateTopic,
} from '@daisy/protocol';
import { createRoomHttpFixture } from './room-http.test-support';
import { withSql } from './fixtures';
requireTestServices(process.env);
setupRitewayBun();
const { f, routes, headers, member, command } = createRoomHttpFixture();
test('real authenticated Round responses and JSON/native replays keep hidden judge identity private', async () => {
  const host = await member(),
    guest = await member(),
    judge = await member();
  let roomId: string | null = null,
    roundId: string | null = null;
  try {
    const catalog = await routes.rooms.catalog(
      new Request(`${f.origin}/api/rooms/catalog`, { headers: headers(host) }),
    );
    const choice = (await catalog.json()).choices.find(
      (c: { formatId: string }) => c.formatId === 'one-on-one',
    );
    const created = await routes.rooms.create(
      f.jsonPost(
        '/api/rooms',
        {
          commandId: createId(),
          title: 'Private judge response proof',
          topic: 'Cities should fund transit',
          visibility: 'public',
          selection: {
            kind: 'catalog',
            formatId: choice.formatId,
            formatVersion: choice.formatVersion,
            length: 'full',
            competitionType: 'casual',
            config: {
              ...choice.defaultConfig,
              preRoundPrep: { enabled: false },
              speechTiming: {
                ...choice.defaultConfig.speechTiming,
                countdownMs: 0,
              },
            },
          },
        },
        { cookie: host },
      ),
    );
    let room = roomViewSchema.parse((await created.json()).view);
    roomId = room.id;
    for (const [cookie, role] of [
      [host, 'affirmative'],
      [guest, 'negative'],
      [judge, 'judge'],
    ] as const)
      room = await command(cookie, room, { type: 'claim-seat', role, slot: 0 });
    for (const [cookie, role] of [
      [host, 'affirmative'],
      [guest, 'negative'],
      [judge, 'judge'],
    ] as const) {
      const own = roomViewSchema.parse(
        await (
          await routes.rooms.read(
            new Request(`${f.origin}/api/rooms/${roomId}`, {
              headers: headers(cookie),
            }),
            roomId,
          )
        ).json(),
      );
      room = await command(cookie, own, {
        type: 'ready',
        expectedConsentVersion: own.participants
          .filter(isNamedSeat)
          .find((p) => p.role === role)!.consentVersion,
      });
    }
    room = await command(host, room, { type: 'start-round' });
    roundId = room.roundRef!.id;
    const started = await routes.rounds.commands(
      f.jsonPost(
        `/api/rounds/${roundId}/commands`,
        {
          version: 1,
          commandId: createId(),
          expectedVersion: 1,
          command: { type: 'start' },
        },
        { cookie: host },
      ),
      roundId,
    );
    const startBody = await started.json();
    const named = roundViewSchema
      .parse(startBody.view)
      .participants.filter(isNamedSeat)
      .find((p) => p.role === 'judge')!;
    const hidden = [named.id, named.actorId, named.label];
    const own = roundViewSchema.parse(
      await (
        await routes.rounds.read(
          new Request(`${f.origin}/api/rounds/${roundId}`, {
            headers: headers(guest),
          }),
          roundId,
        )
      ).json(),
    );
    const seat = own.participants
      .filter(isNamedSeat)
      .find((p) => p.role === 'negative')!;
    const envelope = {
      version: 1,
      commandId: createId(),
      expectedVersion: own.version,
      command: { type: 'forfeit', participantId: seat.id },
    };
    const post = (body: object = envelope) =>
      routes.rounds.commands(
        f.jsonPost(`/api/rounds/${roundId}/commands`, body, { cookie: guest }),
        roundId!,
      );
    const first = await post(),
      retry = await post();
    const firstBody = await first.json(),
      retryBody = await retry.json();
    const native = await routes.rounds.commands(
      new Request(`${f.origin}/api/rounds/${roundId}/commands`, {
        method: 'POST',
        headers: {
          cookie: guest,
          origin: f.origin,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          version: '1',
          commandId: envelope.commandId,
          expectedVersion: String(envelope.expectedVersion),
          type: 'forfeit',
          participantId: seat.id,
        }),
      }),
      roundId,
    );
    const refused = await post({ ...envelope, commandId: createId() });
    const refusal = await refused.json();
    assert({
      given:
        'a nonhost seated debater, hidden human judge and accepted/replayed/refused shared commands',
      should:
        'return truthful receipts without judge identifiers or names and replay native encoding without mutation',
      actual: {
        statuses: [
          started.status,
          first.status,
          retry.status,
          native.status,
          refused.status,
        ],
        versions: [
          firstBody.view.version,
          retryBody.view.version,
          (await f.app.database.getRound(roundId))!.version,
        ],
        replayed: retryBody.receipt.replayed,
        leaks: hidden.filter((value) =>
          JSON.stringify([own, firstBody, retryBody, refusal]).includes(value),
        ),
        nativeDestination: native.headers.get('location'),
      },
      expected: {
        statuses: [200, 200, 200, 303, 409],
        versions: [own.version + 1, own.version + 1, own.version + 1],
        replayed: true,
        leaks: [],
        nativeDestination: `/rounds/${roundId}`,
      },
    });
  } finally {
    if (roomId)
      await withSql(async (sql) => {
        if (roundId)
          await sql`delete from outbox where topic=${buildDebateTopic(roundId)}`;
        await sql`delete from rounds where room_id=${roomId}`;
        await sql`delete from room_commands where room_id=${roomId}`;
        await sql`delete from room_participants where room_id=${roomId}`;
        await sql`delete from outbox where topic=${`room:${roomId}`}`;
        await sql`delete from rooms where id=${roomId}`;
      });
  }
});
