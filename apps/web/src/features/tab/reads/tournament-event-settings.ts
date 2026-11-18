import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  EventSettingParentsChanged,
  type TabStore,
  type TournamentEventSettingFacts,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { TournamentEventSettingsView } from '@daisy/protocol/lobby/resolved-settings-read';
import { eventChain } from '@daisy/protocol/setting-resolution';
import type { SettingScope } from '@daisy/protocol/settings';
import type { TabPrincipal } from '../tab-principal';
import { hostLobbyResource } from '../operations/host-lobby-resource';
import { presetSettingDefaults } from '../operations/format-setting-defaults';
import { settingRow } from '../operations/setting-facts';
import { resolvedSettingsViewOf } from './resolved-settings';
type Dependencies = {
  readonly store: Pick<TabStore, 'tournamentEventSettings'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
};
const requiredSourceName = (name: string | undefined): string => {
  if (!name)
    throw createAppError(
      'INVARIANT',
      'The resolved event setting source is missing',
    );
  return name;
};
const scopeName = (
  facts: TournamentEventSettingFacts,
  scope: SettingScope,
): string => {
  const { lobby, event, template } = facts.configuration;
  switch (scope.kind) {
    case 'organization':
      return requiredSourceName(
        facts.organizations.find((row) => row.id === scope.id)?.name,
      );
    case 'template':
      return requiredSourceName(
        template?.id === scope.id ? template.name : undefined,
      );
    case 'lobby':
      return requiredSourceName(lobby.id === scope.id ? lobby.name : undefined);
    case 'event':
      return requiredSourceName(event.id === scope.id ? event.name : undefined);
  }
};
/** Host-only event settings, resolved from the actual pinned chain inside its read transaction. */
export const readTournamentEventSettings =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    input: {
      readonly lobbyId: string;
      readonly eventId: string;
      readonly area?: 'setup' | 'results' | 'entries';
    },
  ): Promise<TournamentEventSettingsView | null> => {
    if (
      !idSchema.safeParse(input.lobbyId).success ||
      !idSchema.safeParse(input.eventId).success
    )
      return null;
    try {
      return await dependencies.store.tournamentEventSettings(
        { ...input, viewerUserId: principal.userId },
        async (facts) => {
          if (
            !facts ||
            (!facts.authorization.organization && !facts.ownerActorId)
          )
            return null;
          const { lobby, event, template } = facts.configuration;
          const resource = hostLobbyResource(
            lobby,
            facts.authorization.organization,
            facts.ownerActorId,
          );
          const context = {
            account: facts.authorization.account,
            grants: facts.authorization.grants,
            now: dependencies.now(),
          };
          const ask = (capability: AuthorizationInput['capability']) =>
            dependencies.authorize({ principal, resource, context, capability })
              .allow;
          if (
            !ask(
              input.area === 'results'
                ? 'lobby.host.results.read'
                : input.area === 'entries'
                  ? 'lobby.host.entries.read'
                  : 'lobby.setup.manage',
            )
          )
            return null;
          const resolved = resolvedSettingsViewOf(
            {
              at: { kind: 'event', id: event.id },
              chain: eventChain({
                template: template
                  ? { id: template.id, organizationId: template.organizationId }
                  : null,
                leagueId: lobby.ownerOrganizationId,
                lobbyId: lobby.id,
                eventId: event.id,
              }),
              rows: facts.configuration.rows.map(settingRow),
              format: presetSettingDefaults(facts.configuration.preset.config),
              scopeName: (scope) => scopeName(facts, scope),
              reads: 'event',
              ...(input.area === 'results'
                ? { family: 'standings' as const }
                : input.area === 'entries'
                  ? { family: 'entry' as const }
                  : {}),
            },
            ask('lobby.setup.manage'),
          );
          return { ...resolved, settingsVersion: event.settingsVersion };
        },
      );
    } catch (error) {
      if (error instanceof EventSettingParentsChanged) return null;
      throw error;
    }
  };
