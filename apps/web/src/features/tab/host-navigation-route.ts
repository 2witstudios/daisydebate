import { z } from 'zod';
import type { HostNavigationView } from '@daisy/protocol/lobby/host-navigation-read';
import { hostNavigationViewSchema } from '@daisy/protocol/lobby/host-navigation-read';
import type { MemberBoundary } from '../auth/member-boundary';
import { bindTabRead } from './read-route';
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
export const createHostNavigationRoute = (
  dependencies: HostNavigationRouteDependencies,
) =>
  bindTabRead({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.host.navigation',
    query: querySchema,
    view: hostNavigationViewSchema,
    read: async (principal, { kind, handle }) => {
      const id = await (kind === 'organization'
        ? dependencies.organizationIdOfHandle(handle)
        : dependencies.lobbyIdOfHandle(handle));
      return id ? dependencies.read(principal, { kind, id }) : null;
    },
  });
