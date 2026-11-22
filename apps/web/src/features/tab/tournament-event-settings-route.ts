import { idSchema } from '@daisy/protocol/primitives';
import {
  tournamentEventSettingsViewSchema,
  type TournamentEventSettingsView,
} from '@daisy/protocol/lobby/resolved-settings-read';
import { z } from 'zod';
import type { MemberBoundary } from '../../server/member-boundary';
import { bindTabRead } from './read-route';
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
export const createTournamentEventSettingsRoute = (
  dependencies: TournamentEventSettingsRouteDependencies,
) =>
  bindTabRead({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.tournament.event.settings',
    query: querySchema,
    view: tournamentEventSettingsViewSchema,
    read: dependencies.read,
  });
