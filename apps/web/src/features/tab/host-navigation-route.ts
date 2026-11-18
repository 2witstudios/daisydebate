import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import type { HostNavigationView } from '@daisy/protocol/lobby/host-navigation-read';
import { hostNavigationViewSchema } from '@daisy/protocol/lobby/host-navigation-read';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
import type { TabPrincipal } from './tab-principal';

const querySchema = z.strictObject({
  kind: z.enum(['organization', 'lobby']),
  handle: z.string().min(1).max(80),
});
export const hostNavigationPath = (
  kind: 'organization' | 'lobby',
  handle: string,
) => `/api/tab/host-navigation?${new URLSearchParams({ kind, handle })}`;
export type HostNavigationRouteDependencies = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly organizationIdOfHandle: (handle: string) => Promise<string | null>;
  readonly lobbyIdOfHandle: (handle: string) => Promise<string | null>;
  readonly read: (
    principal: TabPrincipal,
    target: { readonly kind: 'organization' | 'lobby'; readonly id: string },
  ) => Promise<HostNavigationView | null>;
};
export const createHostNavigationRoute =
  (dependencies: HostNavigationRouteDependencies) => (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.host.navigation',
      readOnly: true,
      readInput: async () => undefined,
      operation: async (_value, principal) => {
        if (
          principal.kind !== 'user' ||
          !(await dependencies.released(principal.userId))
        )
          throw createAppError('NOT_FOUND');
        const query = parseValidated(
          querySchema,
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const id = await (query.kind === 'organization'
          ? dependencies.organizationIdOfHandle(query.handle)
          : dependencies.lobbyIdOfHandle(query.handle));
        if (!id) throw createAppError('NOT_FOUND');
        const view = await dependencies.read(principal, {
          kind: query.kind,
          id,
        });
        if (!view) throw createAppError('NOT_FOUND');
        return hostNavigationViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
