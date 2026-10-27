import { createId } from '@paralleldrive/cuid2';
import {
  buildDebateTopic,
  roomViewSchema,
  type RoomView,
} from '@daisy/protocol';
import { createRoutes } from '../src/server/routes';
import { inProcessFetch } from '../src/server/in-process-fetch';
import { createAccountFlows, uniqueName } from './auth-account-helpers';
import { createTestApp, withSql } from './fixtures';
export function createRoomHttpFixture() {
  // Explicit env policy through ordinary createApp; no injection/adoption.
  const f = createTestApp({
    ROOM_POLICY: JSON.stringify({
      consentTtlMs: 60_000,
      maxBodyBytes: 262_144,
      limits: {
        create: { max: 20, windowSeconds: 60 },
        read: { max: 200, windowSeconds: 60 },
        command: { max: 200, windowSeconds: 60 },
      },
    }),
  });
  const account = createAccountFlows(f);
  const routes = createRoutes(f.app);
  const headers = (cookie: string) =>
    new Headers({
      cookie,
      origin: f.origin,
      'content-type': 'application/json',
    });
  const member = async () => {
    const signed = await account.signUp();
    const response = await account.claimMember(signed.cookie, {
      username: uniqueName(),
    });
    if (response.status !== 201)
      throw new Error('Fixture membership claim failed');
    return signed.cookie;
  };
  const command = async (cookie: string, view: RoomView, body: object) => {
    const response = await inProcessFetch(
      (request) => routes.rooms.commands(request, view.id),
      headers(cookie),
    )(`/api/rooms/${view.id}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...body,
        commandId: createId(),
        expectedVersion: view.version,
      }),
    });
    if (response.status !== 200)
      throw new Error(
        `Fixture accepted Room command returned ${response.status}`,
      );
    return roomViewSchema.parse((await response.json()).view);
  };
  return { f, routes, headers, member, command };
}

/** Real session/canonical Room journey shared by command-privacy and ballot HTTP suites. */
export async function withHumanJudgeHttpRound(
  h: ReturnType<typeof createRoomHttpFixture>,
  people: {
    readonly host: string;
    readonly guest: string;
    readonly judges: readonly string[];
    readonly countdownMs?: number;
  },
  work: (context: {
    roundId: string;
    roomId: string;
    started: Response;
    startBody: unknown;
  }) => Promise<void>,
) {
  const { f, routes, headers, command } = h;
  const { host, guest, judges } = people;
  let customFormatId: string | null = null;
  let roomId: string | null = null,
    roundId: string | null = null;
  try {
    const catalog = await routes.rooms.catalog(
      new Request(`${f.origin}/api/rooms/catalog`, { headers: headers(host) }),
    );
    const choice = (await catalog.json()).choices.find(
      (c: { formatId: string }) => c.formatId === 'one-on-one',
    );
    const config = {
      ...choice.defaultConfig,
      preRoundPrep: { enabled: false },
      speechTiming: {
        ...choice.defaultConfig.speechTiming,
        countdownMs: people.countdownMs ?? 0,
      },
    };
    const selection =
      judges.length === 1
        ? {
            kind: 'catalog',
            formatId: choice.formatId,
            formatVersion: choice.formatVersion,
            competitionType: 'casual',
            config,
          }
        : {
            kind: 'custom',
            definition: {
              ...choice.definition,
              seats: { ...choice.definition.seats, judge: judges.length },
            },
            competitionType: 'casual',
            config,
          };
    const created = await routes.rooms.create(
      f.jsonPost(
        '/api/rooms',
        {
          commandId: createId(),
          title: 'Private judge response proof',
          topic: 'Cities should fund transit',
          visibility: 'public',
          selection,
        },
        { cookie: host },
      ),
    );
    let room = roomViewSchema.parse((await created.json()).view);
    roomId = room.id;
    if (judges.length > 1) customFormatId = room.formatId;
    const seats = [
      { cookie: host, role: 'affirmative', slot: 0 },
      { cookie: guest, role: 'negative', slot: 0 },
      ...judges.map((cookie, slot) => ({ cookie, role: 'judge', slot })),
    ];
    for (const seat of seats)
      room = await command(seat.cookie, room, {
        type: 'claim-seat',
        role: seat.role,
        slot: seat.slot,
      });
    for (const seat of seats) {
      const own = roomViewSchema.parse(
        await (
          await routes.rooms.read(
            new Request(`${f.origin}/api/rooms/${roomId}`, {
              headers: headers(seat.cookie),
            }),
            roomId,
          )
        ).json(),
      );
      const participant = own.participants.find(
        (p) => 'actorId' in p && p.role === seat.role && p.slot === seat.slot,
      );
      if (!participant || !('consentVersion' in participant))
        throw Error('Own seated consent missing');
      room = await command(seat.cookie, own, {
        type: 'ready',
        expectedConsentVersion: participant.consentVersion,
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
    await work({ roundId, roomId, started, startBody: await started.json() });
  } finally {
    if (roomId)
      await withSql(async (sql) => {
        if (roundId)
          await sql`delete from outbox where topic=${buildDebateTopic(roundId)}`;
        await sql`delete from rounds where room_id=${roomId}`;
        await sql`delete from outbox where topic=${`room:${roomId}`}`;
        await sql`delete from rooms where id=${roomId}`;
        if (customFormatId) {
          await sql`delete from formats where id=${customFormatId}`;
          await sql`delete from format_revisions where format_id=${customFormatId}`;
        }
      });
  }
}
