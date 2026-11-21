import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { query } from './raw-rows';
import { z } from 'zod';

/** One UTC ISO timestamp column, aliased under its bare column name. */
const iso = (column: string, alias: string) =>
  sql.raw(
    `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ${alias}`,
  );

/**
 * The competitive record's subject-rights step (ADR 0087, ISSUE-833): export
 * returns the member's own Rooms (hosted), Room and Round seats, the Rounds
 * they sat in (with resolution and draw evidence) and judged (their ballots),
 * their ladder ratings and changes, and the draw strikes they authored.
 * Erasure is a deliberate no-op: the competitive record is kept whole — the
 * username shows closed and stays reserved — so this step deletes nothing
 * (DEC-261). The member's hosted resolution lists export through the
 * Room-closure step; the draw's private inputs stay with their Room on the
 * record and are not copied here. Like every adopter, it reads only the
 * subject's own rows.
 */
export const competitiveRecordPrivacyAdopter: PrivacyAdopter = {
  id: 'competitive-record',
  phase: 'after-close',
  // DEC-261: nothing on the competitive record is deleted or rewritten.
  erase: async () => {},
  export: async (tx, subject) => ({
    rooms: await query(
      tx,
      z.object({
        id: z.string(),
        host_actor_id: z.string().nullable(),
        created_at: z.string(),
        updated_at: z.string(),
      }),
      sql`select id, host_actor_id,
          ${iso('created_at', 'created_at')}, ${iso('updated_at', 'updated_at')}
        from rooms where host_actor_id = ${subject.actorId} order by id`,
    ),
    room_seat_holds: await query(
      tx,
      z.object({ room_id: z.string(), seat: z.string(), until: z.date() }),
      sql`select room_id, seat, until from room_seat_holds where actor_id = ${subject.actorId} order by room_id`,
    ),
    room_participants: await query(
      tx,
      z.object({
        id: z.string(),
        room_id: z.string(),
        actor_id: z.string(),
        seat_kind: z.string(),
        side: z.string().nullable(),
        slot: z.int(),
      }),
      sql`select id, room_id, actor_id, seat_kind, side, slot
        from room_participants where actor_id = ${subject.actorId} order by id`,
    ),
    round_resolution_strikes: await query(
      tx,
      z.object({
        draw_id: z.string(),
        ordinal: z.int(),
        position: z.int(),
        draw_size: z.int(),
        side: z.string(),
        kind: z.string(),
        actor_id: z.string().nullable(),
        command_id: z.string().nullable(),
        struck_at: z.string(),
      }),
      sql`select draw_id, ordinal, position, draw_size, side,
          kind, actor_id, command_id, ${iso('struck_at', 'struck_at')}
        from round_resolution_strikes
        where actor_id = ${subject.actorId} order by draw_id, ordinal`,
    ),
    round_participants: await query(
      tx,
      z.object({
        id: z.string(),
        round_id: z.string(),
        actor_id: z.string(),
        seat_kind: z.string(),
        side: z.string().nullable(),
        slot: z.int(),
      }),
      sql`select id, round_id, actor_id, seat_kind, side, slot
        from round_participants where actor_id = ${subject.actorId} order by id`,
    ),

    round_judge_slots: await query(
      tx,
      z.object({
        round_id: z.string(),
        slot: z.int(),
        current_version: z.int().nullable(),
        participant_id: z.string().nullable(),
        actor_id: z.string().nullable(),
      }),
      sql`select round_id,slot,current_version,participant_id,actor_id
        from round_judge_slots where actor_id=${subject.actorId} order by round_id,slot`,
    ),
    round_judge_assignments: await query(
      tx,
      z.object({
        round_id: z.string(),
        slot: z.int(),
        version: z.int(),
        previous_version: z.int().nullable(),
        participant_id: z.string().nullable(),
        actor_id: z.string().nullable(),
        source: z.string(),
        command_id: z.string().nullable(),
        recorded_at: z.string(),
      }),
      sql`select round_id,slot,version,previous_version,participant_id,actor_id,source,command_id,
        ${iso('recorded_at', 'recorded_at')} from round_judge_assignments
        where actor_id=${subject.actorId} order by round_id,slot,version`,
    ),
    round_finalization_judge_assignments: await query(
      tx,
      z.object({
        round_id: z.string(),
        slot: z.int(),
        assignment_version: z.int(),
        participant_id: z.string(),
      }),
      sql`select a.round_id,a.slot,a.assignment_version,a.participant_id
        from round_finalization_judge_assignments a join round_participants p on p.id=a.participant_id
        where p.actor_id=${subject.actorId} order by a.round_id,a.slot`,
    ),
    round_source_voids: await query(
      tx,
      z.object({
        round_id: z.string(),
        command_id: z.string(),
        recorded_at: z.string(),
      }),
      sql`select v.round_id,v.command_id,${iso('v.recorded_at', 'recorded_at')}
        from round_source_voids v where exists(select 1 from round_participants p
          where p.round_id=v.round_id and p.actor_id=${subject.actorId}) order by v.round_id`,
    ),
    rounds: await query(
      tx,
      z.object({
        id: z.string(),
        room_id: z.string().nullable(),
        visibility: z.string().nullable(),
        resolution: z.string().nullable(),
        competition_type: z.string(),
        status: z.string(),
        winning_side: z.string().nullable(),
        ranking: z.json().nullable(),
        ladder_id: z.string().nullable(),
        resolution_evidence: z.json().nullable(),
        created_at: z.string(),
        started_at: z.string().nullable(),
        completed_at: z.string().nullable(),
      }),
      sql`select r.id, r.room_id, r.visibility, r.resolution,
          r.competition_type, r.status, r.winning_side, r.ranking, r.ladder_id,
          r.resolution_evidence,
          ${iso('r.created_at', 'created_at')}, ${iso('r.started_at', 'started_at')},
          ${iso('r.completed_at', 'completed_at')}
        from rounds r
        where exists (select 1 from round_participants p
          where p.round_id = r.id and p.actor_id = ${subject.actorId})
        order by r.id`,
    ),
    ballots: await query(
      tx,
      z.object({
        id: z.string(),
        round_id: z.string(),
        rubric_version: z.string(),
        decision: z.string(),
        winner: z.string().nullable(),
        ranking: z.json().nullable(),
        scores: z.json().nullable(),
        reason: z.string().nullable(),
        feedback: z.json().nullable(),
        citations: z.json().nullable(),
        submitted_at: z.string(),
      }),
      sql`select b.id, b.round_id, b.rubric_version, b.decision, b.winner, b.ranking,
          b.scores, b.reason, b.feedback, b.citations,
          ${iso('b.submitted_at', 'submitted_at')}
        from ballots b
        where b.judge_participant_id in (select p.id from round_participants p
          where p.actor_id = ${subject.actorId})
        order by b.id`,
    ),
    ratings: await query(
      tx,
      z.object({
        actor_id: z.string(),
        season_id: z.string(),
        ladder: z.string(),
        rating: z.number(),
        deviation: z.number(),
        volatility: z.number(),
        updated_at: z.string(),
      }),
      sql`select actor_id, season_id, ladder, rating,
          deviation, volatility, ${iso('updated_at', 'updated_at')}
        from ratings where actor_id = ${subject.actorId}
        order by season_id, ladder`,
    ),
    rating_changes: await query(
      tx,
      z.object({
        id: z.string(),
        round_id: z.string(),
        actor_id: z.string(),
        format_id: z.string(),
        season_id: z.string(),
        ladder: z.string(),
        rating_before: z.number(),
        rating_after: z.number(),
        deviation_before: z.number(),
        deviation_after: z.number(),
        volatility_before: z.number(),
        volatility_after: z.number(),
        calculation_version: z.string(),
        occurred_at: z.string(),
      }),
      sql`select id, round_id, actor_id, format_id, season_id,
          ladder, rating_before, rating_after, deviation_before, deviation_after,
          volatility_before, volatility_after, calculation_version,
          ${iso('occurred_at', 'occurred_at')}
        from rating_changes where actor_id = ${subject.actorId}
        order by occurred_at, id`,
    ),
  }),
};
