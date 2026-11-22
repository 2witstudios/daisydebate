import type { TabStore } from '@daisy/db/tab';
import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import { idSchema } from '@daisy/protocol/primitives';
import {
  hostDrawOverviewSchema,
  type HostDrawOverview,
} from '@daisy/protocol/lobby/draw-read';
import { drawAuthority } from '../operations/draw-authority';
import type { TabPrincipal } from '../tab-principal';

export const readHostDrawOverview =
  (dependencies: {
    readonly store: Pick<TabStore, 'hostDrawOverview'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  }) =>
  async (
    principal: TabPrincipal,
    input: { readonly lobbyId: string },
  ): Promise<HostDrawOverview | null> => {
    if (!idSchema.safeParse(input.lobbyId).success) return null;
    return dependencies.store.hostDrawOverview(
      { ...input, viewerUserId: principal.userId },
      async (facts) => {
        if (
          !facts ||
          !dependencies.authorize({
            ...drawAuthority(facts, principal, facts.checkedAt),
            capability: 'lobby.host.draw.read',
          }).allow
        )
          return null;
        return hostDrawOverviewSchema.parse({
          lobbyId: input.lobbyId,
          events: facts.events.map((event) => ({
            eventId: event.id,
            name: event.name,
            rounds: facts.rounds
              .filter((round) => round.eventId === event.id)
              .sort((a, b) => a.number - b.number)
              .map((round) => {
                const draw = facts.draws
                  .filter((draw) => draw.tabRoundId === round.id)
                  .sort((a, b) => b.version - a.version)[0];
                return {
                  tabRoundId: round.id,
                  number: round.number,
                  name: round.name,
                  draw: draw
                    ? {
                        drawId: draw.id,
                        version: draw.version,
                        status: draw.status,
                      }
                    : null,
                };
              }),
          })),
        });
      },
    );
  };
