import { leadSeatOf } from '@daisy/protocol/format-seating';
import { prepConsumedOf } from '@daisy/protocol/round';
import { sameSeat, sideOfSeat } from '@daisy/protocol/seats';
import { segmentDueAtMs } from '@daisy/protocol/segment-end';
import { closeSegmentAt, seatOf, type StepFacts } from './round-commands';
import { debateInvariantIds } from './invariant-ids';
import { invariant, refuse } from './round-refusals';
import {
  clockOf,
  moveFloor,
  withCheckpoint,
  type RoundStep,
} from './round-step';

const iso = (ms: number): string => new Date(ms).toISOString();

const openRowOf = (step: RoundStep) =>
  clockOf(step).rows.find((row) => row.endedAtMs === null);

/**
 * Only the floor holder yields (DEC-203). An interrupter hands the floor back
 * to the segment's scheduled seat, whose segment and clock continue. Only the
 * scheduled speaker's yield closes the segment, and unused time comes back.
 */
export const yieldFloor = (step: RoundStep, f: StepFacts): RoundStep => {
  const open = openRowOf(step);
  if (open === undefined)
    invariant(
      debateInvariantIds.yieldRequiresFloor,
      'Yielding requires a live segment',
    );
  const seat = seatOf(step, f.actorId);
  if (seat === null)
    invariant(
      debateInvariantIds.yieldRequiresFloor,
      'Only the floor holder ends their own control',
    );
  const returnsTime = f.rules.interaction.yield?.returnsTime === true;
  const lead = leadSeatOf(f.rules.segments[open.sequence]!.speak);
  if (lead === null || !sameSeat(seat.seat, lead))
    return moveFloor(withCheckpoint(step, { floor: null }), {
      sequence: open.sequence,
      at: iso(f.now),
      holder: null,
    });
  const unused = segmentDueAtMs(open) - f.now;
  const side = sideOfSeat(lead);
  const { checkpoint } = clockOf(step);
  const returned =
    returnsTime && f.rules.inRoundPrep !== null && unused > 0 && side
      ? withCheckpoint(step, {
          prep_consumed_ms: {
            ...checkpoint.prep_consumed_ms,
            [side]: Math.max(0, prepConsumedOf(checkpoint, side) - unused),
          },
        })
      : step;
  return closeSegmentAt(returned, f.rules, open.sequence, f.now);
};

/** Takes the floor; legality has already refused anything else. */
export const interrupt = (step: RoundStep, f: StepFacts): RoundStep => {
  const seat = seatOf(step, f.actorId);
  if (seat === null) refuse('CONFLICT', 'Only a seated debater interrupts');
  const open = openRowOf(step);
  if (open === undefined)
    invariant(
      debateInvariantIds.interruptRequiresPolicy,
      'The resolved rules forbid interruptions here',
    );
  return moveFloor(
    withCheckpoint(step, {
      floor: { holder_participant_id: seat.id, granted_at: iso(f.now) },
    }),
    { sequence: open.sequence, at: iso(f.now), holder: seat.id },
  );
};
