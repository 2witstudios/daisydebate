import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  hostRoundViewSchema,
  hostDrawOverviewSchema,
  type HostRoundView,
  type HostDrawOverview,
} from '@daisy/protocol/lobby/draw-read';
import { z } from 'zod';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
import type { TabPrincipal } from './tab-principal';
const roundQuery = z.strictObject({
  lobbyId: idSchema,
  eventId: idSchema,
  tabRoundId: idSchema,
});
export const hostRoundPath = (input: z.infer<typeof roundQuery>): string =>
  `/api/tab/host-round?${new URLSearchParams(input)}`;
export const hostDrawOverviewPath = (lobbyId: string): string =>
  `/api/tab/host-draw?${new URLSearchParams({ lobbyId })}`;
type Boundary = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
};
export const createHostRoundRoute =
  (
    dependencies: Boundary & {
      readonly read: (
        principal: TabPrincipal,
        input: z.infer<typeof roundQuery>,
      ) => Promise<HostRoundView | null>;
    },
  ) =>
  (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.host.round',
      readOnly: true,
      readInput: async () => undefined,
      operation: async (_value, principal) => {
        if (
          principal.kind !== 'user' ||
          !(await dependencies.released(principal.userId))
        )
          throw createAppError('NOT_FOUND');
        const input = parseValidated(
          roundQuery,
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const view = await dependencies.read(principal, input);
        if (!view) throw createAppError('NOT_FOUND');
        return hostRoundViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
export const createHostDrawOverviewRoute =
  (
    dependencies: Boundary & {
      readonly read: (
        principal: TabPrincipal,
        input: { readonly lobbyId: string },
      ) => Promise<HostDrawOverview | null>;
    },
  ) =>
  (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.host.draw',
      readOnly: true,
      readInput: async () => undefined,
      operation: async (_value, principal) => {
        if (
          principal.kind !== 'user' ||
          !(await dependencies.released(principal.userId))
        )
          throw createAppError('NOT_FOUND');
        const input = parseValidated(
          z.strictObject({ lobbyId: idSchema }),
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const view = await dependencies.read(principal, input);
        if (!view) throw createAppError('NOT_FOUND');
        return hostDrawOverviewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
