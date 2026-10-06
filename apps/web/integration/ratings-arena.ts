import { createId } from '@paralleldrive/cuid2';
import { fixedIds } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { rateCompletedDebate } from '../src/features/ratings/rate-debate';
import { testDatabaseUrl, withSql } from './fixtures';

/**
 * A rating arena for the real-decision suites (RATE-1.3): a format, an
 * optional active season, debaters on demand and debates between them,
 * rated through `rateCompletedDebate` with the engine's own decision.
 * `cleanup` removes everything it made, ledger rows first.
 */

export const rules = {
  version: 1,
  seats: { affirmative: 1, negative: 1, judge: 1 },
  clock: { speechMs: 240_000, prepMs: 60_000 },
};

export const minute = (n: number) =>
  new Date(Date.UTC(2026, 9, 5, 12, n)).toISOString();

type DebateInput = {
  readonly affirmative: string;
  readonly negative: string;
  readonly mode?: string;
  readonly phase?: 'active' | 'completed';
  readonly outcome?: string;
  readonly completedAt?: string;
  readonly rules?: typeof rules;
};

type LedgerRow = {
  readonly debate_id: string;
  readonly rating_before: number;
  readonly rating_after: number;
  readonly deviation_before: number;
  readonly ladder: string;
  readonly occurred_at: Date;
};

export async function arena(
  options: {
    readonly rankedEligible?: boolean;
    readonly season?: boolean;
  } = {},
) {
  const database = createDatabase({
    url: testDatabaseUrl,
    nextActorId: createId,
  });
  const formatId = `fmt-${createId()}`;
  const seasonIds: string[] = [];
  const users: string[] = [];
  const actors: string[] = [];
  const debates: string[] = [];
  const season = async (status: 'active' | 'closed', startsAt: string) => {
    const id = createId();
    seasonIds.push(id);
    await withSql(
      (sql) => sql`insert into seasons (id, name, starts_at, ends_at, status)
        values (${id}, 'Season', ${new Date(startsAt)},
                ${status === 'closed' ? new Date('2026-10-01T00:00:00.000Z') : null}, ${status})`,
    );
    return id;
  };
  await withSql(
    (sql) => sql`insert into formats (id, name, rules, ranked_eligible)
      values (${formatId}, 'Ranked fixture', ${rules}, ${options.rankedEligible ?? true})`,
  );
  const seasonId =
    options.season === false
      ? null
      : await season('active', '2026-10-01T00:00:00.000Z');

  const actor = async () => {
    const [userId, actorId] = [createId(), createId()];
    users.push(userId);
    actors.push(actorId);
    await withSql(async (sql) => {
      await sql`insert into users (id) values (${userId})`;
      await sql`insert into actors (id, kind, user_id) values (${actorId}, 'human', ${userId})`;
    });
    return actorId;
  };

  const debate = async (input: DebateInput) => {
    const id = createId();
    debates.push(id);
    const phase = input.phase ?? 'completed';
    const completedAt =
      phase === 'completed' ? (input.completedAt ?? minute(30)) : null;
    const snapshot = {
      version: 1,
      id,
      resolution: 'Ratings proof',
      format: formatId,
      rules: input.rules ?? rules,
      phase,
      createdAt: minute(0),
      participants: [],
    };
    await withSql(async (sql) => {
      await sql`insert into debates (id, resolution, format_id, snapshot, mode, phase, visibility, started_at, completed_at, outcome)
        values (${id}, 'Ratings proof', ${formatId}, ${snapshot}, ${input.mode ?? 'ranked'}, ${phase}, 'public',
                ${new Date(minute(0))}, ${completedAt === null ? null : new Date(completedAt)},
                ${phase === 'completed' ? (input.outcome ?? 'negative') : null})`;
      for (const [role, actorId] of [
        ['affirmative', input.affirmative],
        ['negative', input.negative],
      ] as const)
        await sql`insert into debate_participants (debate_id, actor_id, role, slot, status, joined_at)
          values (${id}, ${actorId}, ${role}, 0, 'joined', ${new Date(minute(0))})`;
    });
    return id;
  };

  const rate = (debateId: string) =>
    rateCompletedDebate(database, debateId, fixedIds([createId(), createId()]));

  /** One debater's ledger on this format, in posting order. */
  const ledger = (actorId: string) =>
    withSql(
      (
        sql,
      ) => sql`select debate_id, rating_before, rating_after, deviation_before, ladder, occurred_at
        from rating_changes where actor_id = ${actorId} and format_id = ${formatId}
        order by occurred_at`,
    ) as Promise<LedgerRow[]>;

  const ratings = (actorId: string) =>
    withSql(
      (sql) => sql`select ladder, rating, deviation, version from ratings
        where actor_id = ${actorId} and format_id = ${formatId} order by season_id = ${seasonId ?? ''} desc, ladder`,
    ) as Promise<
      Array<{
        ladder: string;
        rating: number;
        deviation: number;
        version: number;
      }>
    >;

  const cleanup = async () => {
    await withSql(async (sql) => {
      await sql`delete from rating_changes where format_id = ${formatId}`;
      await sql`delete from ratings where format_id = ${formatId}`;
      for (const id of debates) await sql`delete from debates where id = ${id}`;
      for (const id of seasonIds)
        await sql`delete from seasons where id = ${id}`;
      for (const id of actors) await sql`delete from actors where id = ${id}`;
      for (const id of users) await sql`delete from users where id = ${id}`;
      await sql`delete from formats where id = ${formatId}`;
    });
    await database.close();
  };

  return {
    formatId,
    seasonId,
    season,
    actor,
    debate,
    rate,
    ledger,
    ratings,
    cleanup,
  };
}

export type Arena = Awaited<ReturnType<typeof arena>>;

/** Runs `body` in a fresh arena and always cleans it up. */
export async function inArena(
  body: (arena: Arena) => Promise<void>,
  options?: Parameters<typeof arena>[0],
) {
  const made = await arena(options);
  try {
    await body(made);
  } finally {
    await made.cleanup();
  }
}

/** True when each posting starts exactly where the previous one ended. */
export const chained = (rows: readonly LedgerRow[]) =>
  rows.every(
    (row, index) =>
      index === 0 || row.rating_before === rows[index - 1]?.rating_after,
  );
