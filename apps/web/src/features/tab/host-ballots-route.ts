import { idSchema } from '@daisy/protocol';
import {
  hostBallotsViewSchema,
  type HostBallotsView,
} from '@daisy/protocol/lobby/host-ballots-read';
import { z } from 'zod';
import type { MemberBoundary } from '../../server/member-boundary';
import { bindTabRead } from './read-route';
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
export const createHostBallotsRoute = (
  dependencies: HostBallotsRouteDependencies,
) =>
  bindTabRead({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.host.ballots',
    query: querySchema,
    view: hostBallotsViewSchema,
    read: dependencies.read,
  });
