import { CryptoHasher } from 'bun';
import { createAppError } from '@daisy/errors';
import type { RoundProjection } from '@daisy/protocol';

/** One durable decision, in the shape its evidence allows. */
export type AttendanceResolution = {
  readonly segmentId: string;
  readonly projection: RoundProjection | null;
} & (
  | {
      readonly evidence: 'settled_availability';
      readonly decision: 'attended' | 'none' | 'forfeit' | 'abandoned';
      readonly effectiveDeadline: string;
      readonly settledHorizon: string;
    }
  | {
      readonly evidence: 'on_time_receipt';
      readonly decision: 'attended';
      readonly receiptParticipantId: string;
    }
  | {
      readonly evidence: 'resolution_cutoff';
      readonly decision: 'abandoned';
    }
);

type AttendanceSegment = {
  readonly id: string;
  readonly type: string;
  readonly rulesSegmentKey: string;
};
type AttendanceOrder<S> = {
  readonly ruleSegments: readonly {
    readonly key: string;
    readonly type: string;
  }[];
  readonly segments: readonly S[];
  readonly finalizedSegmentIds: readonly string[];
};
/** The engine's speech-order rule, injected: the db never imports the engine. */
export type NextAttendanceWindow = <S extends AttendanceSegment>(
  order: AttendanceOrder<S>,
) => S | undefined;

/** A resolution must name the window whose turn it is. */
export function requireAttendanceTarget<S extends AttendanceSegment>(
  nextWindow: NextAttendanceWindow,
  input: AttendanceOrder<S>,
  resolution: Pick<AttendanceResolution, 'segmentId'>,
): S {
  const target = nextWindow(input);
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
    evidence: resolution.evidence,
    ...adjudicationColumns(resolution),
  },
});

/** What the adjudication row stores beyond its decision; the database constraint repeats this shape. */
export const adjudicationColumns = (resolution: AttendanceResolution) => ({
  effectiveDeadline:
    resolution.evidence === 'settled_availability'
      ? resolution.effectiveDeadline
      : null,
  settledHorizon:
    resolution.evidence === 'settled_availability'
      ? resolution.settledHorizon
      : null,
  receiptParticipantId:
    resolution.evidence === 'on_time_receipt'
      ? resolution.receiptParticipantId
      : null,
});
