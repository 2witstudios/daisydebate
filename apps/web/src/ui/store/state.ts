import type { PresenceStatus as Presence } from '@daisy/protocol';
import type { Tier } from '../types/tier/tier';
import type { TournamentSummary } from '../types/tournament-summary/tournament-summary';
import { debates } from '../mock/debates';
import { tournament } from '../mock/tournament';
import { users } from '../mock/users';

type OnlineUserRow = {
  readonly name: string;
  readonly tier: Tier;
  readonly rating: number;
  readonly presence: Presence;
};

type LiveDebateRow = {
  readonly topic: string;
  readonly viewers: number;
  readonly challenger: string;
  readonly challengerRating: number;
  readonly defender: string;
  readonly defenderRating: number;
};

/**
 * The friends dock: `auto` follows the screen (open when wide, closed when
 * narrow); a visitor's own choice, `open` or `closed`, wins over it.
 */
export type DockState = 'auto' | 'open' | 'closed';

/** The left sidebar: `auto` follows the screen; `collapsed` is icons only. */
export type NavState = 'auto' | 'collapsed';

type UiResources = {
  readonly searchQuery: string;
  readonly onlineCount: number;
  readonly dock: DockState;
  readonly nav: NavState;
  readonly tournament: TournamentSummary;
};

type UiCollections = {
  readonly onlineUsers: readonly OnlineUserRow[];
  readonly liveDebates: readonly LiveDebateRow[];
};

export type UiState = {
  readonly resources: UiResources;
  readonly collections: UiCollections;
};

/** Deterministic seed from the mock fixtures (the future wiring swap point). */
export const createInitialState = (): UiState => ({
  resources: {
    searchQuery: '',
    onlineCount: 1248,
    dock: 'auto',
    nav: 'auto',
    tournament,
  },
  collections: {
    onlineUsers: users.map(({ name, tier, rating, presence }) => ({
      name,
      tier,
      rating,
      presence,
    })),
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
