import { createInvariantError } from '@daisy/errors';
import type { RoundRules } from '@daisy/protocol';
import { debateInvariantIds } from './invariant-ids';
import type { Queues } from './round-commands';
import type { RoundStore } from './round-ecs-store';

/**
 * The clock half of the runtime (ADR 0058 §4): everything time alone can
 * do to an active round — close the live segment when its time is spent,
 * run out the countdown or prep gap, open the next scheduled segment. The
 * command half (`round-commands.ts`) drives the same two row primitives,
 * `openRowOn` and `closeRow`, so a command and a tick leave exactly the
 * same durable shape behind.
 */

const iso = (ms: number): string => new Date(ms).toISOString();

export function createRoundClock(input: {
  readonly rules: RoundRules;
  /** Minted for each projected segment insert; injected, never ambient. */
  readonly nextSegmentId: () => string;
}) {
  const rules = input.rules;

  const closedCountOn = (on: RoundStore): number =>
    on.rows().filter((row) => row.endedAtMs !== null).length;

  /** Prep expiry: the instant the budget runs out, or null while it lasts. */
  const prepExpiresAt = (on: RoundStore): number | null => {
    const active = on.checkpoint().active_prep;
    if (active === null) return null;
    const startedAtMs = Date.parse(active.started_at);
    const budget = rules.inRoundPrep?.budgetMsPerSide ?? 0;
    return (
      startedAtMs +
      Math.max(0, budget - on.checkpoint().prep_consumed_ms[active.side])
    );
  };

  /** True when the open segment is still inside its time and not final. */
  const openStillRunning = (on: RoundStore, now: number): boolean => {
    const open = on.openRow();
    if (open === undefined) return false;
    if (now < open.startedAtMs + open.durationMs) return true;
    // The final segment stays open past its time: the round is spoken but
    // not completed, and the open row remains the live interval until
    // `complete` closes it with the outcome.
    return open.sequence === rules.segments.length - 1;
  };

  /** The open segment's due instant, once its time is spent. */
  const dueAtOf = (on: RoundStore): number =>
    on.openRow()!.startedAtMs + on.openRow()!.durationMs;

  /** Closes the live segment and returns; false when nothing was due. */
  const closeIfDue = (on: RoundStore, into: Queues, now: number): boolean => {
    if (openStillRunning(on, now)) return false;
    const open = on.openRow();
    if (open === undefined) return false;
    closeRow(on, into, open, dueAtOf(on));
    return true;
  };

  /** Runs one prep-or-countdown step; false when the gap is not over. */
  const advanceGap = (on: RoundStore, into: Queues, now: number): boolean => {
    if (closedCountOn(on) >= rules.segments.length) return false;
    const expiresAt = prepExpiresAt(on);
    if (expiresAt !== null) {
      if (now < expiresAt) return false;
      const active = on.checkpoint().active_prep!;
      on.setPrepConsumed(active.side, rules.inRoundPrep?.budgetMsPerSide ?? 0);
      on.endPrep();
      openRowOn(on, into, expiresAt);
      return true;
    }
    const countdownEndsAt =
      (on.lifecycle().gapAnchorMs ?? now) + rules.countdownMs;
    if (now < countdownEndsAt) return false;
    openRowOn(on, into, countdownEndsAt);
    return true;
  };

  /** Advances time alone, projecting whatever the clock moved. */
  const advance = (on: RoundStore, into: Queues, now: number): void => {
    if (on.lifecycle().status !== 'active') return;
    for (;;) {
      if (on.openRow() !== undefined) {
        // A live segment: the only work time can do is close it when due.
        if (!closeIfDue(on, into, now)) return;
        continue;
      }
      if (!advanceGap(on, into, now)) return;
    }
  };

  const closeRow = (
    on: RoundStore,
    into: Queues,
    row: { readonly id: string },
    at: number,
  ): void => {
    on.closeSegment({ id: row.id, endedAtMs: at });
    on.clearFloor();
    on.setLifecycle({ gapAnchorMs: at });
    into.closes.push({ id: row.id, endedAt: iso(at) });
    into.effects.push({
      kind: 'segment_closed',
      key: keyOf(on, row.id),
      at: iso(at),
    });
  };

  const keyOf = (on: RoundStore, id: string): string =>
    on.rows().find((row) => row.id === id)?.key ?? '';

  const openRowOn = (on: RoundStore, into: Queues, at: number): void => {
    if (on.openRow() !== undefined)
      throw createInvariantError(
        debateInvariantIds.liveOpenSegmentCount,
        'A segment opened while another is still open',
      );
    const sequence = closedCountOn(on);
    const expected = rules.segments[sequence];
    if (!expected)
      throw createInvariantError(
        debateInvariantIds.liveOpenSegmentCount,
        'No resolved segment remains to open',
      );
    const id = input.nextSegmentId();
    on.insertSegment({
      id,
      sequence,
      type: expected.type,
      key: expected.key,
      startedAtMs: at,
      durationMs: expected.durationMs,
    });
    into.inserts.push({
      id,
      sequence,
      type: expected.type,
      rulesSegmentKey: expected.key,
      startedAt: iso(at),
      durationMs: expected.durationMs,
    });
    into.effects.push({
      kind: 'segment_opened',
      key: expected.key,
      side: expected.side,
      type: expected.type,
      at: iso(at),
    });
  };

  return { closedCountOn, advance, openRowOn, closeRow };
}
