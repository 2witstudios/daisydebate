import { createAppError } from '@daisy/errors';
import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import type { TabStore } from '@daisy/db/tab';
import { idSchema } from '@daisy/protocol';
import {
  hostEventsViewSchema,
  type HostEventsView,
} from '@daisy/protocol/lobby/host-events-read';
import { hostLobbyResource } from '../operations/host-lobby-resource';
import { tournamentSetupView } from './tournament-setup';
import type { TabPrincipal } from '../tab-principal';
export const readHostEvents =
  (dependencies: {
    readonly store: Pick<TabStore, 'hostEvents'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  }) =>
  async (
    principal: TabPrincipal,
    lobbyId: string,
  ): Promise<HostEventsView | null> => {
    if (!idSchema.safeParse(lobbyId).success) return null;
    return dependencies.store.hostEvents(
      { viewerUserId: principal.userId, lobbyId },
      async (facts) => {
        if (!facts) return null;
        const { setup } = facts;
        if (
          !dependencies.authorize({
            principal,
            resource: hostLobbyResource(
              setup.lobby,
              setup.authorization.organization,
              setup.ownerActorId,
            ),
            context: {
              account: setup.authorization.account,
              grants: setup.authorization.grants,
              now: facts.checkedAt,
            },
            capability: 'lobby.setup.manage',
          }).allow
        )
          return null;
        const view = tournamentSetupView(setup, true);
        if (!view) return null;
        const lobbyResource = hostLobbyResource(
          setup.lobby,
          setup.authorization.organization,
          setup.ownerActorId,
        );
        if (
          lobbyResource.kind !== 'lobby' ||
          lobbyResource.scope.lobbyKind !== 'tournament'
        )
          throw createAppError(
            'INVARIANT',
            'Events require an actual tournament',
          );
        const scope = lobbyResource.scope;
        // Only an actual unreleased Round holds wording back from the pool's authoring read.
        const canReadWord = (wordId: string) =>
          setup.rounds
            .filter(
              (round) =>
                round.poolResolutionId === wordId &&
                round.resolutionReleasedAt === null,
            )
            .every(
              (round) =>
                dependencies.authorize({
                  principal,
                  resource: {
                    kind: 'tab_round',
                    scope,
                    viewing: { audiences: [], releases: [] },
                    resolutionReleased: round.resolutionReleasedAt !== null,
                  },
                  context: {
                    account: setup.authorization.account,
                    grants: setup.authorization.grants,
                    now: facts.checkedAt,
                  },
                  capability: 'tournament.resolutions.read_unreleased',
                }).allow,
            );
        return hostEventsViewSchema.parse({
          setup: view,
          lobbyVersion: setup.lobby.version,
          timeSlotVersions: setup.slots.map((slot) => ({
            timeSlotId: slot.id,
            version: slot.version,
          })),
          resolutionChoices: [
            ...setup.pools.map((pool) => ({
              key: `pool:${pool.id}`,
              label: pool.name,
              wording: null,
              resolution: { poolId: pool.id, poolResolutionId: null },
            })),
            ...facts.resolutions.map((word) => {
              const pool = setup.pools.find((one) => one.id === word.poolId);
              if (!pool)
                throw createAppError('INVARIANT', 'Resolution pool is missing');
              return {
                key: `word:${word.id}`,
                label: pool.name,
                wording: canReadWord(word.id)
                  ? { kind: 'shown', text: word.text }
                  : { kind: 'withheld', addedAt: word.createdAt.toISOString() },
                resolution: { poolId: word.poolId, poolResolutionId: word.id },
              };
            }),
          ],
          pinOptions: [
            ...facts.formats.map((format) => ({
              key: `format:${format.id}:${format.version}`,
              label: `${format.name} · revision ${format.version}`,
              pin: {
                kind: 'format',
                formatId: format.id,
                formatVersion: format.version,
                ballotDefinition: null,
              },
            })),
            ...facts.templates.map((template) => ({
              key: `template:${template.id}`,
              label: `${template.name} · ${template.organizationName}`,
              pin: { kind: 'template', templateId: template.id },
            })),
          ],
        });
      },
    );
  };
