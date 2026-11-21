import { idSchema } from '@daisy/protocol';
import {
  standingsViewSchema,
  type StandingsView,
} from '@daisy/protocol/lobby/standings-read';
import { z } from 'zod';
import type { MemberBoundary } from '../../server/member-boundary';
import { bindTabRead } from './read-route';
import type { TabPrincipal } from './tab-principal';
const querySchema = z.strictObject({ lobbyId: idSchema, eventId: idSchema });
export const hostStandingsPath = (lobbyId: string, eventId: string): string =>
  `/api/tab/host-standings?${new URLSearchParams({ lobbyId, eventId })}`;
export type HostStandingsRouteDependencies = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly read: (
    principal: TabPrincipal,
    input: { readonly lobbyId: string; readonly eventId: string },
  ) => Promise<StandingsView | null>;
};
/** The host results area's computed standings, behind the same closed release as its commands. */
export const createHostStandingsRoute = (
  dependencies: HostStandingsRouteDependencies,
) =>
  bindTabRead({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.host.standings',
    query: querySchema,
    view: standingsViewSchema,
    read: dependencies.read,
  });
