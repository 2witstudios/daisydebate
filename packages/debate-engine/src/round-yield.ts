import { leadSeatOf } from '@daisy/protocol/format-seating';
import { prepConsumedOf } from '@daisy/protocol/round';
import { sideOfSeat } from '@daisy/protocol/seats';
import { segmentDueAtMs } from '@daisy/protocol/segment-end';
import { closeSegmentAt, type StepFacts } from './round-commands';
import { debateInvariantIds } from './invariant-ids';
import { invariant } from './round-refusals';
import { clockOf, withCheckpoint, type RoundStep } from './round-step';

/**
 * The scheduled seat ends its own segment early (DEC-203); legality has
 * already admitted it, including the answering side when a bot asks in
 * cross-examination. Only an early-ended speech returns its unused time to
 * its side's prep, when the rules say so: cross-examination time is never
 * prep (INTX-8).
 */
export const yieldSegment = (step: RoundStep, f: StepFacts): RoundStep => {
  const open = clockOf(step).rows.find((row) => row.endedAtMs === null);
  if (open === undefined)
    invariant(
      debateInvariantIds.yieldRequiresFloor,
      'Yielding requires a live segment',
    );
  const segment = f.rules.segments[open.sequence]!;
  const lead = leadSeatOf(segment.speak);
  const side = lead === null ? null : sideOfSeat(lead);
  const unused = segmentDueAtMs(open) - f.now;
  const { checkpoint } = clockOf(step);
  const returned =
    segment.type === 'speech' &&
    f.rules.interaction.yield?.returnsTime === true &&
    f.rules.inRoundPrep !== null &&
    unused > 0 &&
    side !== null
      ? withCheckpoint(step, {
          prep_consumed_ms: {
            ...checkpoint.prep_consumed_ms,
            [side]: Math.max(0, prepConsumedOf(checkpoint, side) - unused),
          },
        })
      : step;
  return closeSegmentAt(returned, f.rules, open.sequence, f.now);
};
