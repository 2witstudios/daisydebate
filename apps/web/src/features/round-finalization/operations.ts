import { createRoundRuntime, decideStartHorizon } from '@daisy/debate-engine';
import type { Database } from '@daisy/db';

type BuildProjection = Parameters<
  Database['finalizeDueRoundTranscript']
>[0]['buildProjection'];

export function roundTickProjection(
  nextSegmentId: () => string,
): BuildProjection {
  return ({ round, now }) =>
    createRoundRuntime({ ...round, round, nextSegmentId }).tick(now);
}

/**
 * Maintenance's tick: a Round still scheduled past its start horizon is
 * abandoned (DEC-214); any other Round advances by the clock alone.
 */
export function maintenanceTickProjection(
  nextSegmentId: () => string,
  startHorizonMs: number,
): BuildProjection {
  return ({ round, now }) => {
    const runtime = createRoundRuntime({ ...round, round, nextSegmentId });
    return decideStartHorizon({
      status: round.status,
      launchedAtMs: Date.parse(round.launchedAt),
      horizonMs: startHorizonMs,
      nowMs: Date.parse(now),
    }) === 'abandon'
      ? runtime.abandonUnstarted(now)
      : runtime.tick(now);
  };
}
