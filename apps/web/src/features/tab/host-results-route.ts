import { idSchema } from '@daisy/protocol/primitives';
import {
  hostResultsViewSchema,
  type HostResultsView,
} from '@daisy/protocol/lobby/results-read';
import { z } from 'zod';
import type { MemberBoundary } from '../../server/member-boundary';
import { bindTabRead } from './read-route';
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
export const createHostResultsRoute = (
  dependencies: HostResultsRouteDependencies,
) =>
  bindTabRead({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.host.results',
    query: querySchema,
    view: hostResultsViewSchema,
    read: dependencies.read,
  });
