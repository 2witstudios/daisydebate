import { createId } from '@paralleldrive/cuid2';
import { fixedIds } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { rateCompletedRound } from '../src/features/ratings/rate-debate';
import { testDatabaseUrl, withSql } from './fixtures';

/**
 * A rating arena for the real-decision suites (RATE-1.3): a format, an
 * optional active season, debaters on demand and rounds between them,
 * rated through `rateCompletedRound` with the engine's own decision.
 * `cleanup` removes everything it made, ledger rows first.
 */

/** The sanctioned RoomConfig the arena's presets approve. */
const config = {
  preRoundPrep: { enabled: false },
  inRoundPrep: { enabled: true, budgetMsPerSide: 240_000 },
  speechTiming: { countdownMs: 10_000, segmentDurationOverrides: {} },
  crossExamination: { crossExMode: 'ordered' },
  interruptions: { mode: 'cross_ex_only', minRemainingMs: 30_000 },
  yielding: { allowed: true, returnsTime: true },
};

const rules = {
  version: 2,
  seats: { affirmative: 1, negative: 1, judge: 0 },
  segments: [
    {
      key: 'AC',
      label: 'Affirmative constructive',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      durationMs: 240_000,
    },
  ],
  inRoundPrep: null,
  countdownMs: 10_000,
  interaction: { crossExMode: 'ordered', yield: null, interruptions: null },
};

export const minute = (n: number) =>
  new Date(Date.UTC(2026, 9, 5, 12, n)).toISOString();

type RoundInput = {
  readonly affirmative: string;
  readonly negative: string;
  /** `ladderId` null marks an unrated (casual) round. */
  readonly competitionType?: 'ranked' | 'casual';
  readonly length?: 'full' | 'quick';
  readonly status?: 'active' | 'completed' | 'abandoned';
  readonly outcome?: string;
  readonly completedAt?: string;
};

type LedgerRow = {
  readonly round_id: string;
  readonly rating_before: number;
  readonly rating_after: number;
  readonly deviation_before: number;
  readonly ladder: string;
  readonly occurred_at: Date;
};

export async function arena(
  options: {
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
  const rounds: string[] = [];
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
  await withSql(async (sql) => {
    await sql`insert into format_revisions (format_id, version, definition)
      values (${formatId}, 1, ${{ version: 1, seats: rules.seats, segments: [], configurable: { timing: { segmentDurationMs: {}, countdownMs: { min: 0, max: 60_000 } }, inRoundPrep: null, preRoundPrep: null, interaction: { crossExModes: ['ordered'], interruptions: null, yield: null } } }}::jsonb)`;
    await sql`insert into formats (id, name, current_version)
      values (${formatId}, 'Ranked fixture', 1)`;
  });
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

  const round = async (input: RoundInput) => {
    const id = createId();
    rounds.push(id);
    const status = input.status ?? 'completed';
    const competitionType = input.competitionType ?? 'ranked';
    const length = input.length ?? 'full';
    const ladderId =
      competitionType === 'ranked'
        ? length === 'full'
          ? 'ranked'
          : 'quick'
        : null;
    // Abandonment is lifecycle, not outcome: it carries completed_at like any
    // ended round (ADR 0058 §8).
    const completedAt =
      status === 'active' ? null : (input.completedAt ?? minute(30));
    await withSql(async (sql) => {
      // A ranked round is constructed from a sanctioned preset, so it pins
      // one (ADR 0058 §4, §8). The baseline already seeds the one-on-one
      // presets, so the arena only has to name the version it resolved from.
      if (competitionType === 'ranked')
        await sql`insert into format_presets (format_id, length, version, format_version, config, approved_at)
          values (${formatId}, ${length}, 1, 1, ${config}::jsonb, statement_timestamp())
          on conflict (format_id, length, version) do nothing`;
      await sql`insert into rounds (id, resolution, competition_type, length, format_id, format_version, preset_version, rules_snapshot, status, current_stage, started_at, completed_at, outcome, ladder_id)
        values (${id}, 'Ratings proof', ${competitionType}, ${length}, ${formatId}, 1, ${competitionType === 'ranked' ? 1 : null}, ${rules}, ${status},
                ${status === 'active' ? 'live' : null},
                ${new Date(minute(0))},
                ${completedAt === null ? null : new Date(completedAt)},
                ${status === 'completed' ? (input.outcome ?? 'negative') : null}, ${ladderId})`;
      for (const [role, actorId] of [
        ['affirmative', input.affirmative],
        ['negative', input.negative],
      ] as const)
        await sql`insert into round_participants (id, round_id, actor_id, role, slot)
          values (${createId()}, ${id}, ${actorId}, ${role}, 0)`;
    });
    return id;
  };

  const rate = (roundId: string) =>
    rateCompletedRound(database, roundId, fixedIds([createId(), createId()]));

  /** One debater's ledger on this format, in posting order. */
  const ledger = (actorId: string) =>
    withSql(
      (
        sql,
      ) => sql`select round_id, rating_before, rating_after, deviation_before, ladder, occurred_at
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
      for (const id of rounds) await sql`delete from rounds where id = ${id}`;
      for (const id of seasonIds)
        await sql`delete from seasons where id = ${id}`;
      for (const id of actors) await sql`delete from actors where id = ${id}`;
      for (const id of users) await sql`delete from users where id = ${id}`;
      await sql`delete from formats where id = ${formatId}`;
      // Presets point into the revision, so they go before it and after the
      // format whose current_version points there too (ADR 0058 §2a).
      await sql`delete from format_presets where format_id = ${formatId}`;
      await sql`delete from format_revisions where format_id = ${formatId}`;
    });
    await database.close();
  };

  return {
    formatId,
    seasonId,
    season,
    actor,
    round,
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
