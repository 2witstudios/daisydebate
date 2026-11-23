import { idSchema } from '@daisy/protocol/primitives';
import {
  hostRoundViewSchema,
  hostDrawOverviewSchema,
  type HostRoundView,
  type HostDrawOverview,
} from '@daisy/protocol/lobby/draw-read';
import { z } from 'zod';
import type { MemberBoundary } from '../auth/member-boundary';
import { bindTabRead } from './read-route';
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
export const createHostRoundRoute = (
  dependencies: Boundary & {
    readonly read: (
      principal: TabPrincipal,
      input: z.infer<typeof roundQuery>,
    ) => Promise<HostRoundView | null>;
  },
) =>
  bindTabRead({
    ...dependencies,
    name: 'tab.host.round',
    query: roundQuery,
    view: hostRoundViewSchema,
  });
export const createHostDrawOverviewRoute = (
  dependencies: Boundary & {
    readonly read: (
      principal: TabPrincipal,
      input: { readonly lobbyId: string },
    ) => Promise<HostDrawOverview | null>;
  },
) =>
  bindTabRead({
    ...dependencies,
    name: 'tab.host.draw',
    query: z.strictObject({ lobbyId: idSchema }),
    view: hostDrawOverviewSchema,
  });
