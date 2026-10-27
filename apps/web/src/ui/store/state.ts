import type { TournamentSummary } from '../types/tournament-summary/tournament-summary';
import { debates } from '../mock/debates';
import { tournament } from '../mock/tournament';
import { users } from '../mock/users';

type LiveDebateRow = {
  readonly topic: string;
  readonly viewers: number;
  readonly challenger: string;
  readonly challengerRating: number;
  readonly defender: string;
  readonly defenderRating: number;
};

type UiResources = {
  /** How many of the member's friends are online; null until read. */
  readonly friendsOnline: number | null;
  readonly tournament: TournamentSummary;
};

type UiCollections = {
  readonly liveDebates: readonly LiveDebateRow[];
};

export type UiState = {
  readonly resources: UiResources;
  readonly collections: UiCollections;
};

/** Deterministic seed from the mock fixtures (the future wiring swap point). */
export const createInitialState = (): UiState => ({
  resources: {
    friendsOnline: null,
    tournament,
  },
  collections: {
    liveDebates: debates.map((debate) => ({
      topic: debate.topic,
      viewers: debate.viewers,
      challenger: debate.challenger,
      challengerRating:
        users.find((user) => user.name === debate.challenger)?.rating ?? 0,
      defender: debate.defender,
      defenderRating:
        users.find((user) => user.name === debate.defender)?.rating ?? 0,
    })),
  },
});
