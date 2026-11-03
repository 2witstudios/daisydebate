import { requireTestServices } from '@daisy/config';
import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readRoundsAwaitingFactLog,
  recordFactReleases,
} from '../src/spectator-fact-log';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const started = new Date('2026-11-02T00:00:00.000Z');
const ended = new Date('2026-11-02T00:10:00.000Z');
const delay = 90;
const clockAt = (at: Date) => ({
  now: at.toISOString(),
  rankedDelaySeconds: delay,
});
const after = (at: Date, ms: number) => new Date(at.getTime() + ms);

const withEndedRound = async (
  run: (world: {
    readonly db: ReturnType<typeof drizzle>;
    readonly sql: SQL;
    readonly roundId: string;
  }) => Promise<void>,
) => {
  const client = new SQL(databaseUrl, { max: 2 });
  try {
    await withFixture(databaseUrl, async (f) => {
      const host = await f.actor(await f.user());
      const room = await f.room(host, await f.format());
      const roundId = await f.round({
        room_id: room,
        visibility: 'public',
        room_config_snapshot: {},
        status: 'completed',
        competition_type: 'ranked',
        format_id: 'freestyle',
        preset_version: 1,
        ladder_id: 'freestyle',
        outcome: 'affirmative',
        started_at: started,
        completed_at: ended,
      });
      try {
        await run({ db: drizzle({ client }), sql: client, roundId });
      } finally {
        await client`delete from broadcasts where round_id=${roundId}`;
      }
    });
  } finally {
    await client.close();
  }
};
const rows = (sql: SQL, roundId: string) =>
  sql`select kind, fact_id, captured_at, released_at, watermark_at, basis from spectator_fact_releases where round_id=${roundId}` as Promise<
    {
      kind: string;
      fact_id: string;
      captured_at: Date;
      released_at: Date;
      watermark_at: Date | null;
      basis: string;
    }[]
  >;

test('a fact is logged once it left, with both times, and the first release stands', async () => {
  await withEndedRound(async ({ db, sql, roundId }) => {
    await sql`insert into broadcasts (id, round_id, feed_key, release_policy, released_through_at)
      values (${'b' + roundId.slice(1)}, ${roundId}, ${'k' + roundId.slice(1)}, ${{ kind: 'delay', seconds: delay }}, ${ended})`;
    const far = after(ended, 1000 * delay * 100);
    assert({
      given: 'a watermark short of the margin, long after by the clock',
      should: 'log nothing',
      actual: await recordFactReleases(db, { roundId, clock: clockAt(far) }),
      expected: 0,
    });
    const passed = after(ended, SPECTATOR_MARGIN_MS);
    await sql`update broadcasts set released_through_at=${passed} where round_id=${roundId}`;
    await recordFactReleases(db, { roundId, clock: clockAt(far) });
    const first = await rows(sql, roundId);
    assert({
      given: 'the watermark past the result',
      should: 'log its capture time, release time and the watermark',
      actual: first.map((r) => [
        r.kind,
        r.captured_at.toISOString(),
        r.released_at.toISOString(),
        r.watermark_at?.toISOString(),
        r.basis,
      ]),
      expected: [
        [
          'result',
          ended.toISOString(),
          far.toISOString(),
          passed.toISOString(),
          'watermark',
        ],
      ],
    });
    const later = after(far, 5000);
    assert({
      given: 'the same fact seen again later',
      should: 'add nothing and keep the first release time',
      actual: [
        await recordFactReleases(db, { roundId, clock: clockAt(later) }),
        (await rows(sql, roundId))[0]!.released_at.toISOString(),
      ],
      expected: [0, far.toISOString()],
    });
  });
});

test('the log refuses a change, and goes only with its Round', async () => {
  await withEndedRound(async ({ db, sql, roundId }) => {
    await recordFactReleases(db, {
      roundId,
      clock: clockAt(after(ended, 1000 * delay)),
    });
    const refused = async (run: () => PromiseLike<unknown>) =>
      Promise.resolve(run()).then(
        () => 'applied',
        (error: Error) => error.message,
      );
    assert({
      given: 'an update and a delete of a logged fact',
      should: 'refuse both',
      actual: [
        await refused(
          () =>
            sql`update spectator_fact_releases set released_at=${started} where round_id=${roundId}`,
        ),
        await refused(
          () =>
            sql`delete from spectator_fact_releases where round_id=${roundId}`,
        ),
      ],
      expected: [
        'The spectator fact log is append-only',
        'The spectator fact log is append-only',
      ],
    });
    await sql`delete from rounds where id=${roundId}`;
    assert({
      given: 'the Round itself erased',
      should: 'take its log with it',
      actual: (await rows(sql, roundId)).length,
      expected: 0,
    });
  });
});

test('the sweep finds Rounds with an audience, ended inside its window', async () => {
  await withEndedRound(async ({ db, roundId }) => {
    const found = (hours: number, at: Date) =>
      readRoundsAwaitingFactLog(db, {
        clock: clockAt(at),
        endedWithinHours: hours,
        limit: 1000,
      });
    assert({
      given: 'a Round inside and then outside the window',
      should: 'find it, then not',
      actual: [
        (await found(1, after(ended, 1000))).includes(roundId),
        (await found(1, after(ended, 3_700_000))).includes(roundId),
      ],
      expected: [true, false],
    });
  });
});

test('a ranked Round with no Broadcast leaves by the clock, and the log says so', async () => {
  await withEndedRound(async ({ db, sql, roundId }) => {
    assert({
      given: 'no Broadcast, before completion plus the ranked delay',
      should: 'log nothing',
      actual: await recordFactReleases(db, {
        roundId,
        clock: clockAt(after(ended, 1000 * delay - 1)),
      }),
      expected: 0,
    });
    await recordFactReleases(db, {
      roundId,
      clock: clockAt(after(ended, 1000 * delay)),
    });
    assert({
      given: 'the ranked delay passed with no Broadcast',
      should: 'log it as a clock fallback, with no watermark',
      actual: (await rows(sql, roundId)).map((r) => [
        r.kind,
        r.basis,
        r.watermark_at,
      ]),
      expected: [['result', 'clock_fallback', null]],
    });
  });
});
