import {
  leadSeatOf,
  prepConsumedOf,
  sameSeat,
  segmentDueAtMs,
  sideOfSeat,
} from '@daisy/protocol';
import type { CommandContext } from './round-commands';
import { debateInvariantIds } from './invariant-ids';
import { invariant, refuse } from './round-refusals';

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Only the floor holder yields (DEC-203). An interrupter hands the floor back
 * to the segment's scheduled seat, whose segment and clock continue. Only the
 * scheduled speaker's yield closes the segment, and unused time comes back.
 */
export const yieldFloor = (c: CommandContext): void => {
  const open = c.on.openRow();
  if (open === undefined)
    invariant(
      debateInvariantIds.yieldRequiresFloor,
      'Yielding requires a live segment',
    );
  const seat = c.seatOf(c.actorId);
  if (seat === null)
    invariant(
      debateInvariantIds.yieldRequiresFloor,
      'Only the floor holder ends their own control',
    );
  const returnsTime = c.rules.interaction.yield?.returnsTime === true;
  const lead = leadSeatOf(c.rules.segments[open.sequence]!.speak);
  if (lead === null || !sameSeat(seat.seat, lead)) {
    c.on.clearFloor();
    c.into.floorChange = {
      sequence: open.sequence,
      at: iso(c.now),
      holder: null,
    };
    return;
  }
  const unused = segmentDueAtMs(open) - c.now;
  const side = sideOfSeat(lead);
  if (returnsTime && c.rules.inRoundPrep !== null && unused > 0 && side) {
    const checkpoint = c.on.checkpoint();
    c.on.setPrepConsumed({
      ...checkpoint.prep_consumed_ms,
      [side]: Math.max(0, prepConsumedOf(checkpoint, side) - unused),
    });
  }
  c.closeRowAt(open.sequence, c.now);
};

/** Takes the floor; legality has already refused anything else. */
export const interrupt = (c: CommandContext): void => {
  const seat = c.seatOf(c.actorId);
  if (seat === null) refuse('CONFLICT', 'Only a seated debater interrupts');
  const open = c.on.openRow();
  if (open === undefined)
    invariant(
      debateInvariantIds.interruptRequiresPolicy,
      'The resolved rules forbid interruptions here',
    );
  c.on.setFloor({ participantId: seat.id, grantedAtMs: c.now });
  c.into.floorChange = {
    sequence: open.sequence,
    at: iso(c.now),
    holder: seat.id,
  };
};
