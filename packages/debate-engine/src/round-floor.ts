import type { CommandContext } from './round-commands';

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Only the floor holder yields (DEC-203). An interrupter hands the floor back
 * to the segment's scheduled seat, whose segment and clock continue. Only the
 * scheduled speaker's yield closes the segment, and unused time comes back.
 */
export const yieldFloor = (c: CommandContext): void => {
  const open = c.on.openRow()!;
  const seat = c.seatOf(c.actorId)!;
  const returnsTime = c.rules.interaction.yield?.returnsTime === true;
  const scheduled = c.rules.segments[open.sequence]!;
  if (seat.role !== scheduled.side || seat.slot !== scheduled.slot) {
    c.on.clearFloor();
    c.into.floorChange = {
      sequence: open.sequence,
      at: iso(c.now),
      holder: null,
    };
    return;
  }
  const unused = open.startedAtMs + open.durationMs - c.now;
  if (returnsTime && c.rules.inRoundPrep !== null && unused > 0)
    c.on.setPrepConsumed(
      scheduled.side,
      Math.max(0, c.on.checkpoint().prep_consumed_ms[scheduled.side] - unused),
    );
  c.closeRowAt(open.sequence, c.now);
};

/** Takes the floor; legality has already refused anything else. */
export const interrupt = (c: CommandContext): void => {
  const seat = c.seatOf(c.actorId)!;
  c.on.setFloor({ participantId: seat.id, grantedAtMs: c.now });
  c.into.floorChange = {
    sequence: c.on.openRow()!.sequence,
    at: iso(c.now),
    holder: seat.id,
  };
};
