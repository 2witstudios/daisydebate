import { resolveSetting, roomChain } from '@daisy/protocol/setting-resolution';
import { audiences } from '@daisy/protocol/lobby';
import { settingRow } from '../tab/operations/setting-facts';
import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type { TabStore } from '@daisy/db/tab';
import { idSchema } from '@daisy/protocol/primitives';
import {
  lobbyLadderSchema,
  type LobbyLadder,
} from '@daisy/protocol/lobby/lobby-read';
import { hostLobbyResource } from '../tab/operations/host-lobby-resource';
import type { TabPrincipal } from '../tab/tab-principal';
import { leagueStandings } from './league-input';
import { replayPublishedStandings } from './replay-published-standings';
import { summarizeStandings } from './summarize';
import { spectatorClockAt } from '../spectating/spectator-clock';

export const readLeagueLadder =
  (dependencies: {
    readonly store: Pick<TabStore, 'leagueRatings'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  }) =>
  async (
    principal: TabPrincipal,
    input: {
      readonly lobbyId: string;
      readonly scope?: 'top' | 'around';
      readonly search?: string;
      readonly page?: number;
    },
  ): Promise<LobbyLadder | null> => {
    if (!idSchema.safeParse(input.lobbyId).success) return null;
    return dependencies.store.leagueRatings(
      {
        viewerUserId: principal.userId,
        lobbyId: input.lobbyId,
        canReadSource: (authority) => {
          const resource = hostLobbyResource(
            authority.lobby,
            authority.authorization.organization,
            authority.ownerActorId,
          );
          return (
            resource.kind === 'lobby' &&
            dependencies.authorize({
              principal,
              capability: 'lobby.host.read',
              resource,
              context: {
                account: authority.authorization.account,
                grants: authority.authorization.grants,
                now: authority.checkedAt,
              },
            }).allow
          );
        },
      },
      async (facts) => {
        if (!facts) return null;
        const { authority } = facts;
        const hosted = hostLobbyResource(
          authority.lobby,
          authority.authorization.organization,
          authority.ownerActorId,
        );
        if (hosted.kind !== 'lobby') return null;
        const posting = resolveSetting(
          'audience.posting',
          roomChain({
            organizationId: facts.input.ladder.organizationId,
            lobbyId: facts.input.lobby.id,
            templateId: null,
          }),
          facts.input.postingSettings.map(settingRow),
        ).value;
        const resource = {
          ...hosted,
          viewing: {
            audiences:
              authority.authorization.membership === 'active'
                ? ['participants' as const]
                : [],
            releases: [],
          },
          postingAudiences: audiences.filter(
            (audience) => posting[audience] !== 'never',
          ),
        };
        const allowed = (capability: 'lobby.read' | 'lobby.host.read') =>
          dependencies.authorize({
            principal,
            capability,
            resource,
            context: {
              account: authority.authorization.account,
              grants: authority.authorization.grants,
              now: authority.checkedAt,
            },
          }).allow;
        if (!allowed('lobby.read')) return null;
        const entries = allowed('lobby.host.read')
          ? leagueStandings(facts.input).map((row) => ({
              ...row,
              username:
                facts.input.actors.find(
                  (actor) => actor.actorId === row.actorId,
                )?.username ?? null,
            }))
          : summarizeStandings(
              await facts.publicStandings(
                spectatorClockAt(authority.checkedAt),
                replayPublishedStandings,
              ),
              authority.checkedAt,
            ).map((row) => ({
              ...row,
              games: row.played,
              state: { rating: row.rating },
              change: row.lastChange,
            }));
        const sorted = entries.sort(
          (a, b) =>
            b.state.rating - a.state.rating ||
            a.actorId.localeCompare(b.actorId),
        );
        const lines = sorted.map((row, index) => ({
          actorId: row.actorId,
          place: index + 1,
          username: row.username ?? 'Deleted member',
          school: null,
          wins: row.wins,
          losses: row.games - row.wins,
          rating: Math.round(row.state.rating),
          change: Math.round(row.change),
        }));
        const viewer =
          lines.find((row) => row.actorId === principal.actorId) ?? null;
        const search = (input.search ?? '')
          .trim()
          .slice(0, 40)
          .toLocaleLowerCase('en-US');
        const matching = search
          ? lines.filter((row) =>
              row.username.toLocaleLowerCase('en-US').includes(search),
            )
          : lines;
        const pages = Math.max(1, Math.ceil(matching.length / 50));
        const requested =
          input.scope === 'around' && viewer && !search
            ? Math.floor((viewer.place - 1) / 50) + 1
            : (input.page ?? 1);
        const page = Math.max(
          1,
          Math.min(pages, Number.isSafeInteger(requested) ? requested : 1),
        );
        return lobbyLadderSchema.parse({
          lobbyId: input.lobbyId,
          entrants: lines.length,
          page,
          pages,
          viewer,
          lines: matching.slice((page - 1) * 50, page * 50),
        });
      },
    );
  };
