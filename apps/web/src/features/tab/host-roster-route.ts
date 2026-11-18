import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  hostRosterViewSchema,
  type HostRosterView,
} from '@daisy/protocol/lobby/entry-read';
import { z } from 'zod';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
import type { TabPrincipal } from './tab-principal';
const query = z.strictObject({
  lobbyId: idSchema,
  eventId: idSchema.optional(),
});
export const hostRosterPath = (lobbyId: string, eventId?: string): string =>
  `/api/tab/host-roster?${new URLSearchParams({ lobbyId, ...(eventId ? { eventId } : {}) })}`;
export const createHostRosterRoute =
  (dependencies: {
    readonly boundary: MemberBoundary;
    readonly released: (userId: string) => Promise<boolean>;
    readonly read: (
      principal: TabPrincipal,
      input: z.infer<typeof query>,
    ) => Promise<HostRosterView | null>;
  }) =>
  (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.host.roster',
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
        const view = await dependencies.read(principal, input);
        if (!view) throw createAppError('NOT_FOUND');
        return hostRosterViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
