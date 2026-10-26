import { debateInvariantIds } from './invariant-ids';
import type { CommandContext } from './round-commands';
import { invariant, refuse } from './round-refusals';

const iso = (ms: number): string => new Date(ms).toISOString();

const requireYield = (c: CommandContext) => {
  const open = c.on.openRow();
  if (open === undefined)
    invariant(
      debateInvariantIds.yieldRequiresFloor,
      'Yielding requires a live segment',
    );
  const seat = c.seatOf(c.actorId);
  const holder = c.floorHolder(c.on);
  if (seat === null || holder === null || seat.id !== holder.id)
    invariant(
      debateInvariantIds.yieldRequiresFloor,
      'Only the floor holder ends their own control',
    );
  if (c.rules.interaction.yield?.allowed !== true)
    invariant(
      debateInvariantIds.yieldRequiresFloor,
      'The resolved rules forbid yielding',
    );
  return { open, seat, returnsTime: c.rules.interaction.yield.returnsTime };
};

/**
 * Only the floor holder yields (DEC-203). An interrupter hands the floor back
 * to the segment's scheduled seat, whose segment and clock continue; in
 * cross-examination that is the questioner. Only the scheduled speaker's
 * yield closes the segment, and unused time comes back.
 */
export const yieldFloor = (c: CommandContext): void => {
  const { open, seat, returnsTime } = requireYield(c);
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

/** The floor moves only where the resolved policy permits it. */
const requireInterruptWindow = (c: CommandContext) => {
  const open = c.on.openRow();
  const policy = c.rules.interaction.interruptions;
  if (open === undefined || policy === null || policy.allowed === 'disabled')
    invariant(
      debateInvariantIds.interruptRequiresPolicy,
      'The resolved rules forbid interruptions here',
    );
  if (policy.allowed === 'cross_ex_only' && open.type !== 'cross_ex')
    invariant(
      debateInvariantIds.interruptRequiresPolicy,
      'Interruptions are confined to cross-examination',
    );
  const remaining = open.startedAtMs + open.durationMs - c.now;
  if (remaining < policy.minRemainingMs)
    invariant(
      debateInvariantIds.interruptRequiresPolicy,
      'Too little of the segment remains to interrupt',
    );
};

export const interrupt = (c: CommandContext): void => {
  requireInterruptWindow(c);
  const seat = c.seatOf(c.actorId);
  if (seat === null || c.sideOf(c.actorId) === null)
    refuse('CONFLICT', 'Only a seated debater interrupts');
  const holder = c.floorHolder(c.on);
  if (holder !== null && holder.id === seat.id)
    invariant(
      debateInvariantIds.interruptRequiresPolicy,
      'The floor holder cannot interrupt themselves',
    );
  c.on.setFloor({ participantId: seat.id, grantedAtMs: c.now });
  c.into.floorChange = {
    sequence: c.on.openRow()!.sequence,
    at: iso(c.now),
    holder: seat.id,
  };
};
