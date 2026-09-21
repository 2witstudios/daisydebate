import type { Presence } from '../types/presence/presence';
import type { Tier } from '../types/tier/tier';
import type { TournamentSummary } from '../types/tournament-summary/tournament-summary';
import type { Viewer } from '../mock/viewer';
import { activities } from '../mock/activities';
import { debates } from '../mock/debates';
import { topic } from '../mock/topic';
import { tournament } from '../mock/tournament';
import { users } from '../mock/users';
import { viewer } from '../mock/viewer';

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

type ActivityRow = {
  readonly headline: string;
  readonly meta: string;
  readonly actor: string | null;
};

type UiResources = {
  readonly searchQuery: string;
  readonly notificationsCount: number;
  readonly viewer: Viewer;
  readonly onlineCount: number;
  readonly todaysTopic: string;
  readonly tournament: TournamentSummary;
};

type UiCollections = {
  readonly onlineUsers: readonly OnlineUserRow[];
  readonly liveDebates: readonly LiveDebateRow[];
  readonly activities: readonly ActivityRow[];
};

export type UiState = {
  readonly resources: UiResources;
  readonly collections: UiCollections;
};

/** Deterministic seed from the mock fixtures (the future wiring swap point). */
export const createInitialState = (): UiState => ({
  resources: {
    searchQuery: '',
    notificationsCount: 1,
    viewer,
    onlineCount: 1248,
    todaysTopic: topic,
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
    activities: activities.map((activity) => ({
      headline: activity.headline,
      meta: activity.meta,
      actor: activity.actor,
    })),
  },
});
