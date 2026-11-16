import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  lobbyPeopleViewSchema,
  type LobbyPeopleView,
} from '@daisy/protocol/lobby/lobby-people-read';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
import type { TabPrincipal } from './tab-principal';

const querySchema = z.strictObject({ lobbyId: idSchema });
export const lobbyPeoplePath = (lobbyId: string) =>
  `/api/tab/lobby-people?${new URLSearchParams({ lobbyId })}`;
export type LobbyPeopleRouteDependencies = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly read: (
    principal: TabPrincipal,
    lobbyId: string,
  ) => Promise<LobbyPeopleView | null>;
};
export const createLobbyPeopleRoute =
  (dependencies: LobbyPeopleRouteDependencies) => (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.lobby.people',
      readOnly: true,
      readInput: async () => undefined,
      operation: async (_input, principal) => {
        if (
          principal.kind !== 'user' ||
          !(await dependencies.released(principal.userId))
        )
          throw createAppError('NOT_FOUND');
        const { lobbyId } = parseValidated(
          querySchema,
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const view = await dependencies.read(principal, lobbyId);
        if (view === null) throw createAppError('NOT_FOUND');
        return lobbyPeopleViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
