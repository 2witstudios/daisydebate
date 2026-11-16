import {
  hostRoundViewSchema,
  type HostRoundView,
} from '@daisy/protocol/lobby/draw-read';
import type { TabStore } from '@daisy/db/tab';
import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import { idSchema } from '@daisy/protocol';
import type { TabPrincipal } from '../tab-principal';
import { drawAuthority } from '../operations/draw-authority';
import { eventResultsVersion } from '../operations/event-results-version';
import { hostDrawView } from './host-draw';
import { hostRunningRoundView } from './host-running-round';

export const readHostRound =
  (dependencies: {
    readonly store: Pick<TabStore, 'hostRound'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  }) =>
  async (
    principal: TabPrincipal,
    input: {
      readonly lobbyId: string;
      readonly eventId: string;
      readonly tabRoundId: string;
    },
  ): Promise<HostRoundView | null> => {
    if (
      ![input.lobbyId, input.eventId, input.tabRoundId].every(
        (id) => idSchema.safeParse(id).success,
      )
    )
      return null;
    return dependencies.store.hostRound(
      { ...input, viewerUserId: principal.userId },
      async (facts) => {
        if (!facts) return null;
        const loaded = facts.draw;
        const authority = drawAuthority(
          { ...loaded, lobby: loaded.configuration.lobby },
          principal,
          facts.checkedAt,
        );
        const ask = (capability: AuthorizationInput['capability']) =>
          dependencies.authorize({ ...authority, capability }).allow;
        if (!ask('lobby.host.draw.read')) return null;
        const versions = loaded.versions
          .filter((row) => row.tabRoundId === input.tabRoundId)
          .sort((a, b) => b.version - a.version);
        const version = versions[0];
        const guards = {
          draw: version?.version ?? null,
          entries: loaded.configuration.event.entriesVersion,
          settings: loaded.configuration.event.settingsVersion,
          results: eventResultsVersion(loaded),
          timeSlot: loaded.slot?.version ?? null,
        };
        const common = {
          lobbyId: input.lobbyId,
          eventId: input.eventId,
          tabRound: {
            tabRoundId: loaded.round.id,
            number: loaded.round.number,
            name: loaded.round.name,
          },
          guards,
          capabilities: { generate: ask('tournament.draw.edit') },
        };
        if (!version)
          return hostRoundViewSchema.parse({ ...common, kind: 'undrawn' });
        if (version.status === 'published')
          return hostRoundViewSchema.parse({
            ...common,
            kind: 'published',
            round: hostRunningRoundView(
              facts,
              version.id,
              ask('tournament.rooms.officiate'),
              principal.actorId ?? null,
            ),
          });
        return hostRoundViewSchema.parse({
          ...common,
          kind: 'draft',
          draw: hostDrawView(facts, version.id, {
            edit: ask('tournament.draw.edit'),
            publish: ask('tournament.draw.publish'),
          }),
        });
      },
    );
  };
