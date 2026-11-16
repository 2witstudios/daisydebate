import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type { TabStore, TournamentSetupFacts } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  lobbySetupViewSchema,
  type TournamentSetupView,
} from '@daisy/protocol/lobby/lobby-setup-read';
import type { TabPrincipal } from '../tab-principal';
import { hostLobbyResource } from '../operations/host-lobby-resource';
type Dependencies = {
  readonly store: Pick<TabStore, 'tournamentSetup'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
};
const organizationRef = (facts: TournamentSetupFacts, id: string) => {
  const row = facts.organizations.find((one) => one.id === id);
  if (!row)
    throw createAppError(
      'INVARIANT',
      'A setup organization reference is missing',
    );
  return { organizationId: row.id, name: row.name };
};
const project = (
  facts: TournamentSetupFacts,
  manage: boolean,
): TournamentSetupView | null => {
  const view = {
    kind: 'tournament' as const,
    lobbyId: facts.lobby.id,
    handle: facts.lobby.handle,
    name: facts.lobby.name,
    owner: facts.lobby.ownerOrganizationId
      ? organizationRef(facts, facts.lobby.ownerOrganizationId)
      : null,
    status: facts.tournament.status,
    events: facts.events.map((event) => {
      const format = facts.formats.find((row) => row.id === event.formatId);
      const ballot = event.ballotDefinitionId
        ? facts.ballots.find((row) => row.id === event.ballotDefinitionId)
        : null;
      const template = event.templateId
        ? facts.templates.find((row) => row.id === event.templateId)
        : null;
      if (
        !format ||
        (event.ballotDefinitionId && !ballot) ||
        (event.templateId && !template)
      )
        throw createAppError(
          'INVARIANT',
          'A pinned setup definition is missing',
        );
      return {
        eventId: event.id,
        name: event.name,
        label: event.label,
        entryKind: event.entryKind,
        format: {
          formatId: event.formatId,
          formatVersion: event.formatVersion,
          name: format.name,
        },
        ballotDefinition: ballot
          ? {
              ballotDefinitionId: ballot.id,
              ballotDefinitionVersion: event.ballotDefinitionVersion,
              name: ballot.name,
            }
          : null,
        template: template
          ? {
              templateId: template.id,
              name: template.name,
              organization: {
                organizationId: template.organizationId,
                name: template.organizationName,
              },
            }
          : null,
        stages: facts.stages
          .filter((row) => row.eventId === event.id)
          .map((row) => ({
            stageId: row.id,
            kind: row.kind,
            sequence: row.sequence,
            division: row.division,
            place: row.place,
            timing: row.timing,
          })),
        tabRounds: facts.rounds
          .filter((row) => row.eventId === event.id)
          .map((row) => ({
            tabRoundId: row.id,
            stageId: row.stageId,
            number: row.number,
            name: row.name,
            timeSlotId: row.timeSlotId,
            resolutionPoolId: row.resolutionPoolId,
          })),
        sanctions: facts.sanctions
          .filter((row) => row.eventId === event.id)
          .map((sanction) => ({
            organization: organizationRef(facts, sanction.organizationId),
            status: sanction.status,
            requestedAt: sanction.createdAt.toISOString(),
          })),
      };
    }),
    timeSlots: facts.slots.map((row) => ({
      timeSlotId: row.id,
      name: row.name,
      startsAt: row.startsAt.toISOString(),
    })),
    resolutionPools: facts.pools.map((row) => ({
      resolutionPoolId: row.id,
      name: row.name,
      size: facts.poolSizes.find((one) => one.poolId === row.id)?.count ?? 0,
    })),
    capabilities: { manage },
  };
  const parsed = lobbySetupViewSchema.parse(view);
  return parsed.kind === 'tournament' ? parsed : null;
};
/** Named host read: current authority and its projection remain inside the same transaction. */
export const readTournamentSetup =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    lobbyId: string,
  ): Promise<TournamentSetupView | null> => {
    if (!idSchema.safeParse(lobbyId).success) return null;
    return dependencies.store.tournamentSetup(
      { viewerUserId: principal.userId, lobbyId },
      async (facts) => {
        if (
          !facts ||
          (!facts.authorization.organization && !facts.ownerActorId)
        )
          return null;
        const resource = hostLobbyResource(
          facts.lobby,
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
        return project(facts, ask('lobby.setup.manage'));
      },
    );
  };
