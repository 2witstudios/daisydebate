import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { isNamedSeat, type RoomCreate } from '@daisy/protocol';

import { withRoomRuntime } from './room-runtime.test-support';
requireTestServices(process.env);
setupRitewayBun();

const valueSelection = {
  kind: 'catalog' as const,
  formatId: 'value',
  formatVersion: 1,
  presetVersion: 1,
  competitionType: 'casual' as const,
};

/** The published value resolution the practice room pins (FMT-1). */
const valueResolutionId = async (f: {
  store: {
    listPublishedResolutions: () => Promise<
      readonly { kind: string; id: string }[]
    >;
  };
}) => {
  const resolutions = await f.store.listPublishedResolutions();
  return resolutions.find((resolution) => resolution.kind === 'value')!.id;
};

const valueBody = (
  resolutionId: string,
  cast: RoomCreate['cast'],
): RoomCreate => ({
  commandId: createId(),
  title: 'Practice against a bot',
  resolution: { kind: 'value', id: resolutionId },
  visibility: 'public',
  selection: valueSelection,
  cast,
});

const castRows = (f: {
  sql: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Record<string, unknown>[]>;
}) =>
  f.sql`select * from room_participants p join rooms r on r.id = p.room_id where r.title = 'Practice against a bot'`;

/** Rooms a test created without the tracking fixture helper still delete cleanly. */
const deleteRooms = async (
  f: {
    sql: (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<unknown>;
  },
  ids: readonly string[],
) => {
  for (const id of ids) {
    await f.sql`delete from outbox where topic=${`room:${id}`}`;
    await f.sql`delete from outbox where topic in (select 'round:' || id from rounds where room_id=${id})`;
    await f.sql`delete from rounds where room_id=${id}`;
    await f.sql`delete from rooms where id=${id}`;
  }
};

test('a create with an initial cast persists it atomically and stays assembling until the host claims a side', async () => {
  await withRoomRuntime(async (f) => {
    const { actorId: botId } = await f.bot();
    const { actorId: judgeId } = await f.aiJudge();
    const { receipt, view } = await f.create({
      selection: valueSelection,
      cast: [
        { actorId: botId, role: 'negative', slot: 0 },
        { actorId: judgeId, role: 'judge', slot: 0 },
      ],
    });
    const claimed = await f.command(f.host, view, {
      type: 'claim-seat',
      role: 'affirmative',
      slot: 0,
    });
    const startRefusal = await f.operations
      .command(f.host, claimed.view.id, {
        type: 'start-round',
        commandId: createId(),
        expectedVersion: claimed.view.version,
      })
      .then(
        () => 'started',
        (error: { message?: string }) => error.message ?? 'unknown',
      );
    assert({
      given:
        'a create casting a bot debater at negative and the AI judge judging',
      should:
        'persist the cast in one receipt, keep the Room assembling until the host claims, and never mint readiness',
      actual: {
        resultingVersion: receipt.resultingVersion,
        viewVersion: view.version,
        cast: view.participants
          .filter((p) => p.kind === 'bot')
          .map((p) => [p.role, p.slot, p.kind])
          .sort(),
        assembling: view.status,
        afterClaim: claimed.view.status,
        startRefusal,
      },
      expected: {
        resultingVersion: 3,
        viewVersion: 3,
        cast: [
          ['judge', 0, 'bot'],
          ['negative', 0, 'bot'],
        ],
        assembling: 'assembling',
        afterClaim: 'ready',
        startRefusal: 'not-ready',
      },
    });
  });
});

test('a cast refusal rolls the whole create back', async () => {
  await withRoomRuntime(async (f) => {
    const { actorId: botId } = await f.bot();
    const { actorId: judgeId } = await f.aiJudge();
    const member = await f.member();
    const resolutionId = await valueResolutionId(f);
    const attempt = (cast: RoomCreate['cast']) =>
      f.operations.create(member, valueBody(resolutionId, cast));
    const refused = [
      {
        given: 'a cast seating one actor twice',
        cast: [
          { actorId: botId, role: 'negative' as const, slot: 0 },
          { actorId: botId, role: 'affirmative' as const, slot: 0 },
        ],
      },
      {
        given: 'a cast naming an actor that does not exist',
        cast: [
          {
            actorId: `z9${botId.slice(2)}`,
            role: 'negative' as const,
            slot: 0,
          },
        ],
      },
      {
        given: 'a bot debater requested for the judge seat',
        cast: [{ actorId: botId, role: 'judge' as const, slot: 0 }],
      },
      {
        given: 'the AI judge requested for a side seat',
        cast: [{ actorId: judgeId, role: 'negative' as const, slot: 0 }],
      },
    ];
    for (const { given, cast } of refused)
      await assertRejects({
        given,
        should: 'refuse the create with nothing persisted',
        actual: () => attempt(cast),
        code: 'CONFLICT',
      });
    const leftovers = await castRows(f);
    assert({
      given: 'every refused cast create',
      should: 'leave no seat, room row, membership or receipt behind',
      actual: leftovers.length,
      expected: 0,
    });
  });
});

/** A fresh fixture bot and the practice create that seats it at negative. */
const practiceBody = async (f: {
  bot: () => Promise<{ actorId: string }>;
  store: {
    listPublishedResolutions: () => Promise<
      readonly { kind: string; id: string }[]
    >;
  };
}) => {
  const { actorId: botId } = await f.bot();
  return {
    botId,
    body: valueBody(await valueResolutionId(f), [
      { actorId: botId, role: 'negative', slot: 0 },
    ]),
  };
};

test('a replayed create with a cast returns the original receipt even after the bot is disabled', async () => {
  await withRoomRuntime(async (f) => {
    const created: string[] = [];
    try {
      const { botId, body } = await practiceBody(f);
      const first = await f.operations.create(f.host, body);
      created.push(first.view.id);
      await f.sql`delete from bot_profiles where actor_id = ${botId}`;
      const replayed = await f.operations.create(f.host, body);
      const view = await f.operations.view(f.host, first.view.id);
      assert({
        given:
          'the committed create command resubmitted after the bot profile is gone',
        should:
          'replay the original receipt and view before any roster or availability validation',
        actual: {
          replayed: replayed.receipt.replayed,
          sameRoom: replayed.receipt.roomId === first.receipt.roomId,
          version: replayed.receipt.resultingVersion,
          castStillSeated: view.participants.some(
            (p) =>
              isNamedSeat(p) && p.actorId === botId && p.role === 'negative',
          ),
        },
        expected: {
          replayed: true,
          sameRoom: true,
          version: 2,
          castStillSeated: true,
        },
      });
    } finally {
      await deleteRooms(f, created);
    }
  });
});

test('competing submissions of one create command serialize to one create and one replay', async () => {
  await withRoomRuntime(async (f) => {
    const created: string[] = [];
    try {
      const { body } = await practiceBody(f);
      const settled = await Promise.allSettled([
        f.operations.create(f.host, body),
        f.operations.create(f.host, body),
      ]);
      const replays = settled.map((outcome) => {
        if (outcome.status !== 'fulfilled') return null;
        created.push(outcome.value.view.id);
        return outcome.value.receipt.replayed;
      });
      const seats = await castRows(f);
      assert({
        given: 'two concurrent creates sharing one commandId',
        should: 'create exactly one Room and replay the receipt for the other',
        actual: {
          replays: replays.sort().reverse(),
          rooms: seats.length,
        },
        expected: { replays: [true, false], rooms: 1 },
      });
    } finally {
      await deleteRooms(f, created);
    }
  });
});

test('a cast actor whose durable profile is already gone refuses inside the transaction', async () => {
  await withRoomRuntime(async (f) => {
    const { actorId: botId } = await f.bot();
    await f.sql`delete from bot_profiles where actor_id = ${botId}`;
    const member = await f.member();
    const body = valueBody(await valueResolutionId(f), [
      { actorId: botId, role: 'negative', slot: 0 },
    ]);
    await assertRejects({
      given: 'a fresh create whose cast actor lost its profile before it',
      should:
        'refuse under the transaction lock as ineligible with nothing persisted',
      actual: () => f.operations.create(member, body),
      code: 'CONFLICT',
    });
    const seats = await castRows(f);
    assert({
      given: 'the refused create',
      should: 'leave no seat behind',
      actual: seats.length,
      expected: 0,
    });
  });
});
