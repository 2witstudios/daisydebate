import { createAppError } from '@daisy/errors';
import {
  lobbySetupViewSchema,
  type TournamentSetupView,
} from '@daisy/protocol/lobby/lobby-setup-read';
import { z } from 'zod';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
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
export const createTournamentSetupRoute =
  (dependencies: TournamentSetupRouteDependencies) => (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.tournament.setup',
      readOnly: true,
      readInput: async () =>
        parseValidated(
          querySchema,
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      operation: async (input, principal) => {
        if (
          principal.kind !== 'user' ||
          !(await dependencies.released(principal.userId))
        )
          throw createAppError('NOT_FOUND');
        const { handle } = input as z.infer<typeof querySchema>;
        const lobbyId = await dependencies.lobbyIdOfHandle(handle);
        const view =
          lobbyId === null ? null : await dependencies.read(principal, lobbyId);
        if (view === null) throw createAppError('NOT_FOUND');
        return lobbySetupViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
