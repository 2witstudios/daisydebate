import { idSchema } from '@daisy/protocol';
import {
  hostEventsViewSchema,
  type HostEventsView,
} from '@daisy/protocol/lobby/host-events-read';
import { z } from 'zod';
import type { MemberBoundary } from '../../server/member-boundary';
import { bindTabRead } from './read-route';
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
export const createHostEventsRoute = (
  dependencies: HostEventsRouteDependencies,
) =>
  bindTabRead({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.host.events',
    query: query,
    view: hostEventsViewSchema,
    read: (principal, { lobbyId }) => dependencies.read(principal, lobbyId),
  });
