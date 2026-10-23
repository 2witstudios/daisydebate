import { CryptoHasher } from 'bun';
import { createAppError } from '@daisy/errors';
import type { RoundProjection } from '@daisy/protocol';

export type AttendanceResolution = {
  readonly segmentId: string;
  readonly decision: 'attended' | 'none' | 'forfeit' | 'abandoned';
  readonly effectiveDeadline: string;
  readonly settledHorizon: string;
  readonly projection: RoundProjection | null;
};

/**
 * Windows resolve in actual speech order: the earliest unadjudicated speech
 * other than the final one. The final speech has no later check-in window.
 */
export function requireAttendanceTarget<
  S extends {
    readonly id: string;
    readonly type: string;
    readonly rulesSegmentKey: string;
  },
>(
  input: {
    readonly ruleSegments: readonly {
      readonly key: string;
      readonly type: string;
    }[];
    readonly segments: readonly S[];
    readonly finalizedSegmentIds: readonly string[];
  },
  resolution: Pick<AttendanceResolution, 'segmentId'>,
): S {
  const lastSpeech = input.ruleSegments
    .filter((segment) => segment.type === 'speech')
    .at(-1)?.key;
  const target = input.segments.find(
    (segment) =>
      segment.type === 'speech' &&
      segment.rulesSegmentKey !== lastSpeech &&
      !input.finalizedSegmentIds.includes(segment.id),
  );
  if (!target || target.id !== resolution.segmentId)
    throw createAppError(
      'INVARIANT',
      'Attendance windows must resolve in actual speech order',
    );
  return target;
}

/** Only a forfeit or abandonment changes the Round, and only through the engine. */
export function requireResolutionProjection(
  resolution: AttendanceResolution,
): void {
  if (
    resolution.decision === 'forfeit' ||
    resolution.decision === 'abandoned'
  ) {
    if (!resolution.projection)
      throw createAppError(
        'INVARIANT',
        'Competitive attendance completion requires shared engine projection',
      );
  } else if (resolution.projection !== null)
    throw createAppError(
      'INVARIANT',
      'Noncompetitive attendance cannot mutate Round lifecycle',
    );
}

/** The durable adjudication command: its digest binds Round, segment and decision. */
export const adjudicationCommand = (
  roundId: string,
  segmentId: string,
  resolution: AttendanceResolution,
) => ({
  payloadDigest: new CryptoHasher('sha3-256')
    .update(
      JSON.stringify({ roundId, segmentId, decision: resolution.decision }),
    )
    .digest('hex'),
  result: {
    segmentId,
    decision: resolution.decision,
    effectiveDeadline: resolution.effectiveDeadline,
    settledHorizon: resolution.settledHorizon,
  },
});
