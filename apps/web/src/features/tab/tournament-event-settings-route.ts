import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  tournamentEventSettingsViewSchema,
  type TournamentEventSettingsView,
} from '@daisy/protocol/lobby/resolved-settings-read';
import { z } from 'zod';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
import type { TabPrincipal } from './tab-principal';
const querySchema = z.strictObject({
  lobbyId: idSchema,
  eventId: idSchema,
  area: z.enum(['setup', 'results', 'entries']).default('setup'),
});
export const tournamentEventSettingsPath = (
  lobbyId: string,
  eventId: string,
  area: 'setup' | 'results' | 'entries' = 'setup',
): string =>
  `/api/tab/tournament-event-settings?${new URLSearchParams({ lobbyId, eventId, ...(area !== 'setup' ? { area } : {}) })}`;
export type TournamentEventSettingsRouteDependencies = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly read: (
    principal: TabPrincipal,
    input: {
      readonly lobbyId: string;
      readonly eventId: string;
      readonly area?: 'setup' | 'results' | 'entries';
    },
  ) => Promise<TournamentEventSettingsView | null>;
};
/** The host's resolved event settings, behind the same closed release as its commands. */
export const createTournamentEventSettingsRoute =
  (dependencies: TournamentEventSettingsRouteDependencies) =>
  (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.tournament.event.settings',
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
        if (view === null) throw createAppError('NOT_FOUND');
        return tournamentEventSettingsViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
