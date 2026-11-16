import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import { EventSettingParentsChanged, type TabStore } from '@daisy/db/tab';
import {
  ballotDefinitionSchema,
  freezeBallotJudging,
  idSchema,
} from '@daisy/protocol';
import {
  eventBallotAuthoringViewSchema,
  type EventBallotAuthoringView,
} from '@daisy/protocol/lobby/ballot-read';
import { eventChain, resolveSetting } from '@daisy/protocol/setting-resolution';
import { hostLobbyResource } from '../operations/host-lobby-resource';
import { settingRow } from '../operations/setting-facts';
import { presetSettingDefaults } from '../operations/format-setting-defaults';
import type { TabPrincipal } from '../tab-principal';

/** The host reads exact source content and the guards for separate publication and event pinning. */
export const readEventBallot =
  (dependencies: {
    readonly store: Pick<TabStore, 'eventBallot'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly now: () => string;
  }) =>
  async (
    principal: TabPrincipal,
    input: { readonly lobbyId: string; readonly eventId: string },
  ): Promise<EventBallotAuthoringView | null> => {
    if (
      !idSchema.safeParse(input.lobbyId).success ||
      !idSchema.safeParse(input.eventId).success
    )
      return null;
    try {
      return await dependencies.store.eventBallot(
        { ...input, viewerUserId: principal.userId },
        async (facts) => {
          if (
            !facts ||
            (!facts.authorization.organization && !facts.ownerActorId)
          )
            return null;
          const {
            lobby,
            event,
            template,
            definition: format,
            preset,
            rows,
          } = facts.configuration;
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
          if (!ask('lobby.setup.manage')) return null;
          const manage = ask('lobby.setup.manage');
          const source =
            event.ballotDefinitionId === null &&
            event.ballotDefinitionVersion === null
              ? null
              : facts.versions.find(
                  (row) =>
                    row.ballotDefinitionId === event.ballotDefinitionId &&
                    row.version === event.ballotDefinitionVersion,
                );
          if (
            (event.ballotDefinitionId !== null ||
              event.ballotDefinitionVersion !== null) &&
            !source
          )
            return null;
          const parsed = source
            ? ballotDefinitionSchema.safeParse(source.definition)
            : null;
          if (parsed && !parsed.success) return null;
          const frozen = freezeBallotJudging(
            format.definition,
            source && parsed?.success
              ? {
                  source: {
                    kind: 'stored',
                    id: source.ballotDefinitionId,
                    version: source.version,
                  },
                  ballot: parsed.data,
                }
              : null,
          );
          if (frozen.kind === 'refused') return null;
          const sourceOwner = facts.definitions.find(
            (row) => row.id === event.ballotDefinitionId,
          );
          if (
            source &&
            (!sourceOwner ||
              !(
                sourceOwner.lobbyId === lobby.id ||
                (sourceOwner.organizationId !== null &&
                  [
                    lobby.ownerOrganizationId,
                    template?.organizationId,
                  ].includes(sourceOwner.organizationId))
              ))
          )
            return null;
          const screening = resolveSetting(
            'ballot.screening',
            eventChain({
              template,
              leagueId: lobby.ownerOrganizationId,
              lobbyId: lobby.id,
              eventId: event.id,
            }),
            rows.map(settingRow),
            presetSettingDefaults(preset.config),
          );
          const screeningLocked =
            screening.hold === 'enforced' &&
            !(
              screening.source.kind === 'event' &&
              screening.source.id === event.id
            );
          return eventBallotAuthoringViewSchema.parse({
            lobbyId: lobby.id,
            eventId: event.id,
            name: event.name,
            label: event.label,
            versions: {
              lobby: lobby.version,
              event: event.version,
              settings: event.settingsVersion,
            },
            definition: frozen.judging
              ? { source: frozen.judging.source, ballot: frozen.judging.ballot }
              : null,
            sourceName: frozen.judging
              ? (sourceOwner?.name ?? 'Daisy ballot')
              : null,
            followsTemplate: event.templateId !== null,
            entriesExist: facts.entriesExist,
            segments: format.definition.segments.map((segment) => ({
              key: segment.key,
              label: segment.label,
              individual: segment.speak.rights === 'one',
            })),
            screening: screening.value.value,
            definitions: facts.definitions
              .filter(
                (row) =>
                  row.lobbyId === lobby.id ||
                  (row.organizationId !== null &&
                    row.organizationId === lobby.ownerOrganizationId),
              )
              .map((row) => ({
                id: row.id,
                name: row.name,
                owned: row.lobbyId === lobby.id,
                currentVersion: row.currentVersion,
                versions: facts.versions
                  .filter((version) => version.ballotDefinitionId === row.id)
                  .flatMap((version) => {
                    const ballot = ballotDefinitionSchema.safeParse(
                      version.definition,
                    );
                    return ballot.success
                      ? [
                          {
                            version: version.version,
                            definition: ballot.data,
                            compatible:
                              freezeBallotJudging(format.definition, {
                                source: {
                                  kind: 'stored',
                                  id: row.id,
                                  version: version.version,
                                },
                                ballot: ballot.data,
                              }).kind === 'frozen',
                          },
                        ]
                      : [];
                  }),
              })),
            capabilities: {
              publish:
                manage &&
                lobby.kind === 'tournament' &&
                lobby.closedAt === null,
              pin:
                manage &&
                lobby.closedAt === null &&
                event.templateId === null &&
                !facts.entriesExist,
              setScreening:
                manage && !screeningLocked && lobby.closedAt === null,
            },
          });
        },
      );
    } catch (error) {
      if (error instanceof EventSettingParentsChanged) return null;
      throw error;
    }
  };
