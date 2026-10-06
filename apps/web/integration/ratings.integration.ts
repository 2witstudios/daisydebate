import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { fixedIds } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { rateDebate, ratingPolicy } from '@daisy/debate-engine';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rateCompletedDebate } from '../src/features/ratings/rate-debate';
import { testDatabaseUrl, withSql } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();

const rules = {
  version: 1,
  seats: { affirmative: 1, negative: 1, judge: 1 },
  clock: { speechMs: 240_000, prepMs: 60_000 },
};
const completedAt = '2026-10-05T12:30:00.000Z';

/** A ranked-eligible format, an active season and two seated debaters. */
async function arena() {
  const formatId = `fmt-${createId()}`;
  const seasonId = createId();
  const users = [createId(), createId()];
  const actors = [createId(), createId()];
  await withSql(async (sql) => {
    await sql`insert into formats (id, name, rules, ranked_eligible)
      values (${formatId}, 'Ranked fixture', ${rules}, true)`;
    await sql`insert into seasons (id, name, starts_at, status)
      values (${seasonId}, 'Season', ${new Date('2026-10-01T00:00:00.000Z')}, 'active')`;
    for (const [index, actorId] of actors.entries()) {
      await sql`insert into users (id) values (${users[index]})`;
      await sql`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${users[index]})`;
    }
  });
  const debates: string[] = [];
  const debate = async (debateRules: typeof rules) => {
    const id = createId();
    debates.push(id);
    const snapshot = {
      version: 1,
      id,
      resolution: 'Ratings proof',
      format: formatId,
      rules: debateRules,
      phase: 'completed',
      createdAt: '2026-10-05T12:00:00.000Z',
      participants: [],
    };
    await withSql(async (sql) => {
      await sql`insert into debates (id, resolution, format_id, snapshot, mode, phase, visibility, started_at, completed_at, outcome)
        values (${id}, 'Ratings proof', ${formatId}, ${snapshot}, 'ranked', 'completed', 'public',
                ${new Date('2026-10-05T12:00:00.000Z')}, ${new Date(completedAt)}, 'negative')`;
      for (const [index, role] of (
        ['affirmative', 'negative'] as const
      ).entries())
        await sql`insert into debate_participants (debate_id, actor_id, role, slot, status, joined_at)
          values (${id}, ${actors[index]}, ${role}, 0, 'joined', ${new Date('2026-10-05T12:00:00.000Z')})`;
    });
    return id;
  };
  const cleanup = () =>
    withSql(async (sql) => {
      await sql`delete from rating_changes where format_id = ${formatId}`;
      await sql`delete from ratings where format_id = ${formatId}`;
      for (const id of debates) await sql`delete from debates where id = ${id}`;
      await sql`delete from seasons where id = ${seasonId}`;
      for (const id of actors) await sql`delete from actors where id = ${id}`;
      for (const id of users) await sql`delete from users where id = ${id}`;
      await sql`delete from formats where id = ${formatId}`;
    });
  return { formatId, seasonId, actors, debate, cleanup };
}

describe('rating a completed debate (RATE-1.3)', () => {
  test('writes exactly the engine calculation, once', async () => {
    const database = createDatabase({
      url: testDatabaseUrl,
      nextActorId: createId,
    });
    const { seasonId, actors, debate, cleanup } = await arena();
    try {
      const debateId = await debate(rules);
      const result = await rateCompletedDebate(
        database,
        debateId,
        fixedIds([createId(), createId()]),
      );
      const expected = rateDebate({
        affirmative: { state: ratingPolicy.initial, lastRatedAt: null },
        negative: { state: ratingPolicy.initial, lastRatedAt: null },
        outcome: 'negative',
        occurredAt: completedAt,
      });
      const stored = await withSql(
        (
          sql,
        ) => sql`select actor_id, rating, deviation, volatility, ladder, version
          from ratings where season_id = ${seasonId} order by rating desc`,
      );
      assert({
        given:
          'a completed ranked debate on canonical rules won by the negative',
        should:
          'store the engine calculation for both debaters on the ranked ladder at version 1',
        actual: {
          kind: result.kind,
          stored: stored.map((row: Record<string, unknown>) => ({ ...row })),
        },
        expected: {
          kind: 'rated',
          stored: [
            {
              actor_id: actors[1],
              ...expected.negative.after,
              ladder: 'ranked',
              version: 1,
            },
            {
              actor_id: actors[0],
              ...expected.affirmative.after,
              ladder: 'ranked',
              version: 1,
            },
          ],
        },
      });
      const again = await rateCompletedDebate(
        database,
        debateId,
        fixedIds([createId(), createId()]),
      );
      assert({
        given: 'the same debate rated again',
        should: 'report it already rated',
        actual: again.kind,
        expected: 'already-rated',
      });
    } finally {
      await cleanup();
      await database.close();
    }
  });

  test('never rates a debate whose rules were overridden', async () => {
    const database = createDatabase({
      url: testDatabaseUrl,
      nextActorId: createId,
    });
    const { formatId, debate, cleanup } = await arena();
    try {
      const debateId = await debate({
        ...rules,
        clock: { speechMs: 60_000, prepMs: 0 },
      });
      const result = await rateCompletedDebate(
        database,
        debateId,
        fixedIds([createId(), createId()]),
      );
      const [{ rows }] = await withSql(
        (sql) =>
          sql`select count(*)::int as rows from rating_changes where format_id = ${formatId}`,
      );
      assert({
        given: 'a ranked debate run under overridden rules',
        should: 'leave it unrated and write nothing',
        actual: [result, rows],
        expected: [{ kind: 'unrated', reason: 'rules' }, 0],
      });
    } finally {
      await cleanup();
      await database.close();
    }
  });
});
