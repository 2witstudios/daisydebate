import type { RoundStore } from './context';
import type { FakeRoundState } from './round-store-state.test-support';

/**
 * The usage half of the fake store: the agent-run rows behind the TTS and
 * practice budgets and the reservation writes, with the real claim-then-check
 * reservation order.
 */
export const usageMethods = (state: FakeRoundState) => ({
  async recordAgentRun(input: Parameters<RoundStore['recordAgentRun']>[0]) {
    state.runRows.push({
      id: input.id,
      roundParticipantId: input.roundParticipantId,
      kind: input.kind,
      characters: input.characters ?? 0,
    });
  },

  async spokenCharactersFor(input: { roundParticipantId: string }) {
    return state.runRows
      .filter(
        (row) =>
          row.roundParticipantId === input.roundParticipantId &&
          row.kind === 'tts',
      )
      .reduce((sum, row) => sum + row.characters, 0);
  },

  /**
   * Claim-then-check, matching the real reservation: the characters are
   * counted first and the budget decides afterwards, so two requests that
   * interleave cannot both pass on the same starting total. Bun is
   * single-threaded here, so interleaving is simulated by the fact that
   * the sum is taken *after* the row exists — a read-then-write
   * implementation would pass twice under this store too, which is
   * exactly the bug the real test in `packages/db` pins.
   */
  async reserveSpokenCharacters(input: {
    id: string;
    roundParticipantId: string;
    characters: number;
    budget: number;
    model: string;
    provider: string;
  }) {
    const spent = state.runRows
      .filter(
        (row) =>
          row.roundParticipantId === input.roundParticipantId &&
          row.kind === 'tts',
      )
      .reduce((sum, row) => sum + row.characters, 0);
    state.runRows.push({
      id: input.id,
      roundParticipantId: input.roundParticipantId,
      kind: 'tts',
      characters: input.characters,
    });
    return spent + input.characters <= input.budget;
  },

  async reserveAiPractice(input: {
    id: string;
    actorId: string;
    roundId: string;
  }) {
    const held = state.reservationActors.get(input.actorId) ?? [];
    state.reservationActors.set(input.actorId, [...held, input.roundId]);
  },

  async markReservationCounted(_input: { actorId: string; roundId: string }) {},

  async countRecentAiPractice(input: { actorId: string }) {
    return (state.reservationActors.get(input.actorId) ?? []).length;
  },

  /** Unfinished rounds across everyone, matching `countLiveRounds`. */
  async countLiveRounds() {
    return [...state.rounds.values()].filter(
      (row) => row.status === 'scheduled' || row.status === 'active',
    ).length;
  },
});
