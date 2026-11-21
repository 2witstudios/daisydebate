import type { SQL } from 'bun';
import { createAppError } from '@daisy/errors';
import { z } from 'zod';
import { query } from './raw-rows';

/**
 * The published incident rate, and capture's coverage, over one period, from
 * Round ids and instants alone. Coverage is null when nothing was measured;
 * streams that fell short by an unmeasured amount are counted, never assumed.
 */
export async function readRoundIncidentRate(
  sql: SQL,
  period: { readonly from: Date; readonly until: Date },
) {
  const [row] = await query(
    sql`
    select
      (select count(*)::int from round_incidents
        where detected_at >= ${period.from} and detected_at < ${period.until}) as incidents,
      (select count(*)::int from rounds
        where platform_ending is not null and completed_at >= ${period.from}
          and completed_at < ${period.until}) as ended_rounds,
      (select coalesce(sum(extract(epoch from
          least(coalesce(completed_at, clock_timestamp()), ${period.until}::timestamptz)
          - greatest(started_at, ${period.from}::timestamptz))), 0)::float8 / 3600
        from rounds where started_at < ${period.until}
          and coalesce(completed_at, clock_timestamp()) > ${period.from}) as round_hours,
      (select coalesce(sum(expected_speech_ms), 0)::float8 from round_transcript_freezes
        where frozen_at >= ${period.from} and frozen_at < ${period.until}
          and unheard_ms is not null) as expected_ms,
      (select coalesce(sum(capture_gap_ms), 0)::float8 from round_transcript_freezes
        where frozen_at >= ${period.from} and frozen_at < ${period.until}
          and unheard_ms is not null) as gap_ms,
      (select count(*)::int from round_transcript_freezes
        where frozen_at >= ${period.from} and frozen_at < ${period.until}
          and unheard_ms is null) as unmeasured_rounds`,
    z.object({
      incidents: z.int(),
      ended_rounds: z.int(),
      round_hours: z.number(),
      expected_ms: z.number(),
      gap_ms: z.number(),
      unmeasured_rounds: z.int(),
    }),
  );
  if (!row)
    throw createAppError('INVARIANT', 'Incident rate query returned no row');
  const roundHours = row.round_hours;
  const expectedMs = row.expected_ms;
  return {
    incidents: row.incidents,
    endedRounds: row.ended_rounds,
    roundHours,
    incidentsPer1000RoundHours:
      roundHours > 0 ? (row.incidents / roundHours) * 1000 : null,
    captureCoverage: expectedMs > 0 ? 1 - row.gap_ms / expectedMs : null,
    unmeasuredRounds: row.unmeasured_rounds,
  };
}
