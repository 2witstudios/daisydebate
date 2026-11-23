import { z } from 'zod';
import { idSchema } from '@daisy/protocol/primitives';
import {
  lobbyPeopleViewSchema,
  type LobbyPeopleView,
} from '@daisy/protocol/lobby/lobby-people-read';
import type { MemberBoundary } from '../auth/member-boundary';
import { bindTabRead } from './read-route';
import type { TabPrincipal } from './tab-principal';

const querySchema = z.strictObject({ lobbyId: idSchema });
export const lobbyPeoplePath = (lobbyId: string) =>
  `/api/tab/lobby-people?${new URLSearchParams({ lobbyId })}`;
export type LobbyPeopleRouteDependencies = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly read: (
    principal: TabPrincipal,
    lobbyId: string,
  ) => Promise<LobbyPeopleView | null>;
};
export const createLobbyPeopleRoute = (
  dependencies: LobbyPeopleRouteDependencies,
) =>
  bindTabRead({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.lobby.people',
    query: querySchema,
    view: lobbyPeopleViewSchema,
    read: (principal, { lobbyId }) => dependencies.read(principal, lobbyId),
  });
