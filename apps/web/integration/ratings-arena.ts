import { createId } from '@paralleldrive/cuid2';
import type { RatingDivision, RatingStyle } from '@daisy/protocol';
import { fixedIds } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import {
  affirmativeSide,
  emptyRuntimeCheckpointFor,
  negativeSide,
} from '@daisy/protocol';
import { validRules, daisyOrganizationId } from '@daisy/db/testing';
import { rateCompletedRound } from '../src/features/ratings/rate-debate';
import { testDatabaseUrl, withSql } from './fixtures';
import { deleteOrphanNotificationSignals } from './notification-signals.test-support';

/**
 * A rating arena for the real-decision suites (RATE-1.3): a format, an
 * optional active season, debaters on demand and rounds between them,
 * rated through `rateCompletedRound` with the engine's own decision.
 * `cleanup` removes everything it made, ledger rows first.
 */

/** The one-speech arena rules: the shared fixture cut to its opening segment. */
const rules = {
  ...validRules,
  segments: [validRules.segments[0]!],
  inRoundPrep: null,
};

export const minute = (n: number) =>
  new Date(Date.UTC(2026, 9, 5, 12, n)).toISOString();

type RoundInput = {
  readonly ladder?: RatingStyle;
  /** The ranked Round's division; Open unless named. */
  readonly division?: RatingDivision;
  readonly affirmative: string;
  readonly negative: string;
  /** `ladderId` null marks a casual round. */
  readonly competitionType?: 'ranked' | 'casual';
  readonly status?: 'active' | 'completed' | 'abandoned';
  readonly outcome?: string;
  readonly completedAt?: string;
  readonly visibility?: 'public';
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
  const formatId = 'freestyle';
  const seasonIds: string[] = [];
  const users: string[] = [];
  const actors: string[] = [];
  const rounds: string[] = [];
  const lobby = async (division: RatingDivision) => {
    const ageRule = division === 'youth' ? 'under-18' : 'adults';
    const [scope] = await withSql(
      (sql) => sql`select l.id as lobby_id,d.id as ladder_id
      from lobbies l join ladders d on d.lobby_id=l.id
      where l.owner_organization_id=${daisyOrganizationId} and l.age_rule=${ageRule}
      order by l.created_at,l.id,d.created_at,d.id limit 1`,
    );
    return scope!;
  };
  const active = new Map<RatingDivision, string>();
  const season = async (
    status: 'active' | 'closed',
    startsAt: string,
    division: RatingDivision = 'open',
  ) => {
    const id = createId();
    seasonIds.push(id);
    const pool = await lobby(division);
    await withSql(
      (
        sql,
      ) => sql`insert into seasons (organization_id, id, name, lobby_id, starts_at, ends_at, status)
        values (${daisyOrganizationId}, ${id}, 'Season', ${pool.lobby_id}, ${new Date(startsAt)},
                ${status === 'closed' ? new Date('2026-10-01T00:00:00.000Z') : null}, ${status})`,
    );
    if (status === 'active') active.set(division, id);
    return id;
  };
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
    const formatId = input.ladder ?? 'freestyle';
    const id = createId();
    rounds.push(id);
    const status = input.status ?? 'completed';
    const competitionType = input.competitionType ?? 'ranked';
    const division = input.division ?? 'open';
    const pool = competitionType === 'ranked' ? await lobby(division) : null;
    const frozenSeason = pool ? (active.get(division) ?? null) : null;
    // Abandonment is lifecycle, not outcome: it carries completed_at like any
    // ended round (ADR 0058 §8).
    const completedAt =
      status === 'active' ? null : (input.completedAt ?? minute(30));
    await withSql((client) =>
      client.begin(async (sql) => {
        // A ranked round is constructed from a sanctioned preset, so it pins
        // one (ADR 0058 §4, §8). The baseline already seeds the one-on-one
        // presets, so the arena only has to name the version it resolved from.
        await sql`insert into rounds (id, resolution, competition_type, format_id, format_version, preset_version, rules_snapshot, status, current_stage, started_at, completed_at, winning_side, ladder_id, season_id, rating_lobby_id, runtime_state, visibility)
        values (${id}, 'Ratings proof', ${competitionType}, ${formatId}, 1, ${competitionType === 'ranked' ? 1 : null}, ${rules}, 'opening', null, null, null, null, ${pool?.ladder_id ?? null}, ${frozenSeason}, ${pool?.lobby_id ?? null}, ${emptyRuntimeCheckpointFor(rules)}, ${input.visibility ?? null})`;
        for (const [side, actorId] of [
          [affirmativeSide, input.affirmative],
          [negativeSide, input.negative],
        ] as const)
          await sql`insert into round_participants (id, round_id, actor_id, seat_kind, side, slot)
          values (${createId()}, ${id}, ${actorId}, 'side', ${side}, 0)`;
        await sql`update rounds set status=${status}, current_stage=${status === 'active' ? 'live' : null}, started_at=${new Date(minute(0))}, completed_at=${completedAt === null ? null : new Date(completedAt)}, winning_side=${status === 'completed' ? (input.outcome ?? 'negative') : null} where id=${id}`;
        if (competitionType === 'ranked' && status === 'completed') {
          const commandId = createId();
          await sql`insert into round_commands(command_id,round_id,actor_id,type,payload_digest,result,resulting_version,applied_at)
          values(${commandId},${id},${input.affirmative},'forfeit',${'a'.repeat(64)},${{}},1,${new Date(completedAt!)} )`;
          await sql`insert into round_finalizations(round_id,command_id,resulting_version) values(${id},${commandId},1)`;
        }
      }),
    );
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
        where actor_id = ${actorId} order by season_id = ${seasonId ?? ''} desc, ladder`,
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
      for (const id of rounds) {
        await sql`delete from rating_changes where round_id=${id}`;
        await sql`delete from round_finalization_ballots where round_id=${id}`;
        await sql`delete from round_finalizations where round_id=${id}`;
        await sql`delete from rounds where id = ${id}`;
        await deleteOrphanNotificationSignals(sql);
      }
      for (const id of actors)
        await sql`delete from ratings where actor_id=${id}`;
      for (const id of seasonIds)
        await sql`delete from seasons where id = ${id}`;
      for (const id of actors) await sql`delete from actors where id = ${id}`;
      for (const id of users) await sql`delete from users where id = ${id}`;
    });
    await database.close();
  };

  return {
    database,
    formatId,
    seasonId,
    season,
    lobby,
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
