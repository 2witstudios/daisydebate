import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  hostEventsViewSchema,
  type HostEventsView,
} from '@daisy/protocol/lobby/host-events-read';
import { z } from 'zod';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
import type { TabPrincipal } from './tab-principal';
const query = z.strictObject({ lobbyId: idSchema });
export const hostEventsPath = (lobbyId: string): string =>
  `/api/tab/host-events?${new URLSearchParams({ lobbyId })}`;
export type HostEventsRouteDependencies = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly read: (
    principal: TabPrincipal,
    lobbyId: string,
  ) => Promise<HostEventsView | null>;
};
export const createHostEventsRoute =
  (dependencies: HostEventsRouteDependencies) => (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.host.events',
      readOnly: true,
      readInput: async () => undefined,
      operation: async (_value, principal) => {
        if (
          principal.kind !== 'user' ||
          !(await dependencies.released(principal.userId))
        )
          throw createAppError('NOT_FOUND');
        const input = parseValidated(
          query,
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const view = await dependencies.read(principal, input.lobbyId);
        if (!view) throw createAppError('NOT_FOUND');
        return hostEventsViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
