import type { TabStore } from '@daisy/db/tab';
import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import { idSchema } from '@daisy/protocol/primitives';
import {
  hostBallotsViewSchema,
  type HostBallotsView,
} from '@daisy/protocol/lobby/host-ballots-read';
import { hostLobbyResource } from '../operations/host-lobby-resource';
import type { TabPrincipal } from '../tab-principal';

/** This area lists real Round addresses; the Round ballot owner still decides every private part. */
export const readHostBallots =
  (dependencies: {
    readonly store: Pick<TabStore, 'hostBallots'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  }) =>
  async (
    principal: TabPrincipal,
    input: { readonly lobbyId: string; readonly eventId: string },
  ): Promise<HostBallotsView | null> => {
    if (
      !idSchema.safeParse(input.lobbyId).success ||
      !idSchema.safeParse(input.eventId).success
    )
      return null;
    return dependencies.store.hostBallots(
      { ...input, viewerUserId: principal.userId },
      async (facts) => {
        if (!facts) return null;
        const authority = {
          principal,
          resource: hostLobbyResource(
            facts.configuration.lobby,
            facts.authorization.organization,
            facts.ownerActorId,
          ),
          context: {
            account: facts.authorization.account,
            grants: facts.authorization.grants,
            now: facts.checkedAt,
          },
        };
        if (
          !dependencies.authorize({
            ...authority,
            capability: 'lobby.host.ballots.read',
          }).allow
        )
          return null;
        return hostBallotsViewSchema.parse({
          ...input,
          rounds: facts.rounds,
          canResolve: dependencies.authorize({
            ...authority,
            capability: 'tournament.results.release',
          }).allow,
        });
      },
    );
  };
