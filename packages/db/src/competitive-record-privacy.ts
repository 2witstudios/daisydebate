import { sql } from 'drizzle-orm';
import type { PrivacyAdopter, PrivacyExport } from './privacy/contracts';

/** One UTC ISO timestamp column, aliased under its bare column name. */
const iso = (column: string, alias: string) =>
  sql.raw(
    `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ${alias}`,
  );

const rows = (query: Promise<unknown>) =>
  query as unknown as Promise<Record<string, unknown>[]>;

/**
 * The competitive record's subject-rights step (ADR 0087, ISSUE-833): export
 * returns the member's own Rooms (hosted), Room and Round seats, the Rounds
 * they sat in (with resolution and draw evidence) and judged (their ballots),
 * and their ladder ratings and changes. Erasure is a deliberate no-op: the
 * competitive record is kept whole — the username shows closed and stays
 * reserved — so this step deletes nothing (DEC-261). The member's hosted
 * resolution lists export through the Room-closure step; the draw's private
 * inputs and strikes stay with their Room on the record and are not copied
 * here. Like every adopter, it reads only the subject's own rows.
 */
export const competitiveRecordPrivacyAdopter: PrivacyAdopter = {
  id: 'competitive-record',
  phase: 'after-close',
  // DEC-261: nothing on the competitive record is deleted or rewritten.
  erase: async () => {},
  export: async (tx, subject) => ({
    rooms: await rows(
      tx.execute(sql`select id, host_actor_id,
          ${iso('created_at', 'created_at')}, ${iso('updated_at', 'updated_at')}
        from rooms where host_actor_id = ${subject.actorId} order by id`),
    ),
    room_participants: await rows(
      tx.execute(sql`select id, room_id, actor_id, role, slot
        from room_participants where actor_id = ${subject.actorId} order by id`),
    ),
    round_participants: await rows(
      tx.execute(sql`select id, round_id, actor_id, role, slot
        from round_participants where actor_id = ${subject.actorId} order by id`),
    ),
    rounds: await rows(
      tx.execute(sql`select r.id, r.room_id, r.visibility, r.resolution,
          r.competition_type, r.status, r.outcome, r.ladder_id,
          r.resolution_evidence,
          ${iso('r.created_at', 'created_at')}, ${iso('r.started_at', 'started_at')},
          ${iso('r.completed_at', 'completed_at')}
        from rounds r
        where exists (select 1 from round_participants p
          where p.round_id = r.id and p.actor_id = ${subject.actorId})
        order by r.id`),
    ),
    ballots: await rows(
      tx.execute(sql`select b.id, b.round_id, b.rubric_version, b.winner,
          b.scores, b.reason, b.feedback, b.citations, b.status,
          ${iso('b.submitted_at', 'submitted_at')}, ${iso('b.voided_at', 'voided_at')}
        from ballots b
        where b.judge_participant_id in (select p.id from round_participants p
          where p.actor_id = ${subject.actorId})
        order by b.id`),
    ),
    ratings: await rows(
      tx.execute(sql`select actor_id, format_id, season_id, ladder, rating,
          deviation, volatility, ${iso('updated_at', 'updated_at')}
        from ratings where actor_id = ${subject.actorId}
        order by format_id, season_id, ladder`),
    ),
    rating_changes: await rows(
      tx.execute(sql`select id, round_id, actor_id, format_id, season_id,
          ladder, rating_before, rating_after, deviation_before, deviation_after,
          volatility_before, volatility_after, calculation_version,
          ${iso('occurred_at', 'occurred_at')}
        from rating_changes where actor_id = ${subject.actorId}
        order by occurred_at, id`),
    ),
  }),
};
