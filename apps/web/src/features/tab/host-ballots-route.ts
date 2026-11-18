import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  hostBallotsViewSchema,
  type HostBallotsView,
} from '@daisy/protocol/lobby/host-ballots-read';
import { z } from 'zod';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
import type { TabPrincipal } from './tab-principal';
const querySchema = z.strictObject({ lobbyId: idSchema, eventId: idSchema });
export const hostBallotsPath = (lobbyId: string, eventId: string): string =>
  `/api/tab/host-ballots?${new URLSearchParams({ lobbyId, eventId })}`;
export type HostBallotsRouteDependencies = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly read: (
    principal: TabPrincipal,
    input: { readonly lobbyId: string; readonly eventId: string },
  ) => Promise<HostBallotsView | null>;
};
/** The host ballots area's real Round addresses, behind the same closed release as its commands. */
export const createHostBallotsRoute =
  (dependencies: HostBallotsRouteDependencies) => (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.host.ballots',
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
        return hostBallotsViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
