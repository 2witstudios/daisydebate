import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  hostResultsViewSchema,
  type HostResultsView,
} from '@daisy/protocol/lobby/results-read';
import { z } from 'zod';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
import type { TabPrincipal } from './tab-principal';
const querySchema = z.strictObject({ lobbyId: idSchema, eventId: idSchema });
export const hostResultsPath = (lobbyId: string, eventId: string): string =>
  `/api/tab/host-results?${new URLSearchParams({ lobbyId, eventId })}`;
export type HostResultsRouteDependencies = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly read: (
    principal: TabPrincipal,
    input: { readonly lobbyId: string; readonly eventId: string },
  ) => Promise<HostResultsView | null>;
};
/** The host Results area's retained competition, behind the same closed release as its commands. */
export const createHostResultsRoute =
  (dependencies: HostResultsRouteDependencies) => (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.host.results',
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
        return hostResultsViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
