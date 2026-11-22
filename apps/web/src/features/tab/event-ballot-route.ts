import { idSchema } from '@daisy/protocol/primitives';
import {
  eventBallotAuthoringViewSchema,
  type EventBallotAuthoringView,
} from '@daisy/protocol/lobby/ballot-read';
import { z } from 'zod';
import type { MemberBoundary } from '../../server/member-boundary';
import { bindTabRead } from './read-route';
import type { TabPrincipal } from './tab-principal';

const querySchema = z.strictObject({ lobbyId: idSchema, eventId: idSchema });
export const eventBallotPath = (lobbyId: string, eventId: string): string =>
  `/api/tab/event-ballot?${new URLSearchParams({ lobbyId, eventId })}`;
export type EventBallotRouteDependencies = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly read: (
    principal: TabPrincipal,
    input: { readonly lobbyId: string; readonly eventId: string },
  ) => Promise<EventBallotAuthoringView | null>;
};
export const createEventBallotRoute = (
  dependencies: EventBallotRouteDependencies,
) =>
  bindTabRead({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.event.ballot',
    query: querySchema,
    view: eventBallotAuthoringViewSchema,
    read: dependencies.read,
  });
