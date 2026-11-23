import type { RoundStartGateStore } from '@daisy/db/stores/round-start-gates';
import type { RoundHydration } from '@daisy/db/stores/rounds';
import { instantMs } from '@daisy/clock';
import { createRoundRuntime } from '@daisy/debate-engine';
import { roundStartPolicy } from '@daisy/protocol/round-start-policy';

type Store = RoundStartGateStore['roundStartGates'];

/**
 * Whether capture has a speech's speakers before its clock starts (ADR 0110). The pass
 * that opens their microphones says who it is waiting on, and capture's own report releases
 * each. Most reports find nothing waiting on them, so they take no Round lock.
 */
export function createRoundStartGate(input: {
  readonly store: Store;
  readonly nextId: () => string;
}) {
  const runtimeOf = (round: RoundHydration) =>
    createRoundRuntime({
      round,
      rules: round.rules,
      participants: round.participants,
      checkpoint: round.checkpoint,
      segments: round.segments,
      nextSegmentId: input.nextId,
    });
  return {
    awaitCapture: (roundId: string, seats: readonly string[]) =>
      input.store.moveRoundStartGate({
        roundId,
        step: (round, now) =>
          runtimeOf(round).applyStartGate({
            kind: 'await',
            atMs: instantMs(now),
            seats,
            boundMs: roundStartPolicy.captureHoldBoundMs,
          }),
      }),
    heard: async ({
      roundId,
      seat,
    }: {
      readonly roundId: string;
      readonly seat: string;
    }) => {
      const gate = await input.store.readRoundStartGate(roundId);
      if (gate?.phase !== 'awaiting' || !gate.seats.includes(seat)) return;
      await input.store.moveRoundStartGate({
        roundId,
        step: (round, now) =>
          runtimeOf(round).applyStartGate({
            kind: 'heard',
            atMs: instantMs(now),
            seat,
          }),
      });
    },
  };
}
