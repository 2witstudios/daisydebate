import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  standingsViewSchema,
  type StandingsView,
} from '@daisy/protocol/lobby/standings-read';
import { z } from 'zod';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
import type { TabPrincipal } from './tab-principal';
const querySchema = z.strictObject({ lobbyId: idSchema, eventId: idSchema });
export const hostStandingsPath = (lobbyId: string, eventId: string): string =>
  `/api/tab/host-standings?${new URLSearchParams({ lobbyId, eventId })}`;
export type HostStandingsRouteDependencies = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly read: (
    principal: TabPrincipal,
    input: { readonly lobbyId: string; readonly eventId: string },
  ) => Promise<StandingsView | null>;
};
/** The host results area's computed standings, behind the same closed release as its commands. */
export const createHostStandingsRoute =
  (dependencies: HostStandingsRouteDependencies) => (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.host.standings',
      readOnly: true,
      readInput: async () => undefined,
      operation: async (_value, principal) => {
        if (
          principal.kind !== 'user' ||
          !(await dependencies.released(principal.userId))
        )
          throw createAppError('NOT_FOUND');
        const input = parseValidated(
          querySchema,
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const view = await dependencies.read(principal, input);
        if (view === null) throw createAppError('NOT_FOUND');
        return standingsViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
