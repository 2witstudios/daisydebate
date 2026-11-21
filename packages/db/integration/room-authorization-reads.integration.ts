import { requireTestServices } from '@daisy/config';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roomAuthorizationRead } from '../src/room-authorization-read';
import { createAuthorizationSubject } from './authorization.test-support';
import { withDatabase, withFixture } from './constraint-helpers';
import { validConfig, validRules } from './round-fixtures';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('Room and Round authority return minimal native rows and require stored Round visibility', async () => {
  await withFixture(url, async (fixture) => {
    const caller = await createAuthorizationSubject(fixture);
    const formatId = await fixture.format();
    const roomId = await fixture.room(caller.actorId, formatId, {
      visibility: 'private',
      version: 7,
      execution_plan: {
        preRoundPrep: { enabled: false },
        resolutionDraw: { enabled: false },
      },
    });
    const { id: roundId } = await fixture.roundWithCast(
      {
        room_id: roomId,
        format_id: formatId,
        created_by_actor_id: caller.actorId,
        visibility: 'private',
        room_config_snapshot: validConfig,
        resolution: 'Fixture resolution',
      },
      [{ seat: 'affirmative', actorId: caller.actorId }],
    );
    const legacy = await fixture.round({
      created_by_actor_id: caller.actorId,
      visibility: null,
    });
    await fixture.sql`update rounds set version=4 where id=${roundId}`;
    const statements: string[] = [];
    const db = drizzle({
      client: fixture.sql,
      logger: { logQuery: (query) => statements.push(query) },
    });
    const authority = roomAuthorizationRead({ database: db });
    const room = await authority.readRoomAuthorizationFacts(roomId, caller);
    const round = await authority.readRoundAuthorizationFacts(roundId, caller);
    const notVisible = await authority.readRoundAuthorizationFacts(
      legacy,
      caller,
    );
    const roundQuery = statements.find((query) =>
      query.includes('from "rounds"'),
    );
    assert({
      given:
        'an empty private Room, a private Round with a frozen seat, and a legacy Round without stored visibility',
      should:
        'project both native minimal authority facts, omit null join and content fields, and fail closed on missing visibility',
      actual: [
        room?.account?.actorId,
        room?.resource,
        round?.account?.actorId,
        round?.resource,
        notVisible,
        roundQuery
          ? [
              'title',
              'resolution',
              'rules_snapshot',
              'room_config_snapshot',
            ].filter((field) => roundQuery.includes(`"${field}"`))
          : null,
      ],
      expected: [
        caller.actorId,
        {
          kind: 'room',
          roomId,
          hostActorId: caller.actorId,
          visibility: 'private',
          status: 'assembling',
          revision: 7,
          participants: [],
        },
        caller.actorId,
        {
          kind: 'round',
          roundId,
          createdByActorId: caller.actorId,
          visibility: 'private',
          status: 'opening',
          revision: 4,
          participants: [
            {
              actorId: caller.actorId,
              seat: { kind: 'side', side: 'affirmative', slot: 0 },
            },
          ],
        },
        null,
        [],
      ],
    });
    await withDatabase(url, async (database) => {
      await fixture.sql`update users set username='CurrentHost' where id=${caller.userId}`;
      const source = await database.readRoomAssembly(
        roomId,
        caller,
        (candidate, fact) =>
          fact?.member === true && candidate.hostActorId === caller.actorId,
        () => null,
      );
      await fixture.sql`update rounds set status='active',current_stage='countdown',started_at=statement_timestamp() where id=${roundId}`;
      const view = await database.readLaunchedRound(
        roundId,
        caller,
        (candidate, fact) =>
          fact?.member === true &&
          candidate.hostActorId === caller.actorId &&
          candidate.status === 'active',
        (_opening, _seats, _viewer, now) => ({
          view: {
            step: { step: 'complete', at: now },
            draw: null,
            canStrike: false,
            sides: null,
          },
          topic: null,
        }),
        () => null,
        () => false,
      );
      assert({
        given:
          'a new host name before reading the same Room and its launched Round',
        should:
          'hydrate the pinned Room rules and current participant identity, reusing the stored Round resolution',
        actual: [
          source.hostLabel,
          source.rules,
          source.participants,
          view.status,
          view.topic,
          view.participants.flatMap((person) =>
            'anonymous' in person ? [] : [person.label],
          ),
        ],
        expected: [
          'CurrentHost',
          validRules,
          [],
          'active',
          'Fixture resolution',
          ['CurrentHost'],
        ],
      });
    });
  });
});
