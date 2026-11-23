import {
  lobbySetupViewSchema,
  type TournamentSetupView,
} from '@daisy/protocol/lobby/lobby-setup-read';
import { z } from 'zod';
import type { MemberBoundary } from '../auth/member-boundary';
import { bindTabRead } from './read-route';
import type { TabPrincipal } from './tab-principal';
const querySchema = z.strictObject({
  handle: z.string().trim().min(1).max(64),
});
export const tournamentSetupPath = (handle: string): string =>
  `/api/tab/tournament-setup?${new URLSearchParams({ handle })}`;
export type TournamentSetupRouteDependencies = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly lobbyIdOfHandle: (handle: string) => Promise<string | null>;
  readonly read: (
    principal: TabPrincipal,
    lobbyId: string,
  ) => Promise<TournamentSetupView | null>;
};
/** A closed release, unknown address and absent host authority all answer not found. */
export const createTournamentSetupRoute = (
  dependencies: TournamentSetupRouteDependencies,
) =>
  bindTabRead({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.tournament.setup',
    query: querySchema,
    view: lobbySetupViewSchema,
    validateBeforeRelease: true,
    read: async (principal, { handle }) => {
      const lobbyId = await dependencies.lobbyIdOfHandle(handle);
      return lobbyId === null ? null : dependencies.read(principal, lobbyId);
    },
  });
