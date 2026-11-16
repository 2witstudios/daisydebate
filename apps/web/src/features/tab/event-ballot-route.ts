import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  eventBallotAuthoringViewSchema,
  type EventBallotAuthoringView,
} from '@daisy/protocol/lobby/ballot-read';
import { z } from 'zod';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
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
export const createEventBallotRoute =
  (dependencies: EventBallotRouteDependencies) => (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.event.ballot',
      readOnly: true,
      readInput: async () => undefined,
      operation: async (_value, principal) => {
        if (
          principal.kind !== 'user' ||
          !(await dependencies.released(principal.userId))
        )
          throw createAppError('NOT_FOUND');
        const input = parseValidated(
          querySchema,
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const view = await dependencies.read(principal, input);
        if (!view) throw createAppError('NOT_FOUND');
        return eventBallotAuthoringViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
