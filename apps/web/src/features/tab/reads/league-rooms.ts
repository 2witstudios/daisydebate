import { openSetting, type SettingLine } from '../settings';
import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type { LeagueSeasonFacts } from '@daisy/db/tab';
import { seatsOfKind } from '@daisy/protocol/format-seating';
import { isRoundRunning } from '@daisy/protocol/round';
import { releaseAudiences } from '@daisy/protocol/release-audience';
import { roomChain, resolveSetting } from '@daisy/protocol/setting-resolution';
import type { LeaguePanel } from '../league';
import type { TabPrincipal } from '../tab-principal';
import { hostLobbyResource } from '../operations/host-lobby-resource';
import { settingRow } from '../operations/setting-facts';
import { linkTo } from '../action';

export type LeagueRoomsRead = {
  readonly panel: Extract<LeaguePanel, { kind: 'rooms' }>;
  readonly canCreate: boolean;
  readonly settings: readonly SettingLine[];
};
/** Only this lobby's evaluated room-list audience receives a bounded projection, never raw rules or identities. */
export function readLeagueRooms(
  facts: LeagueSeasonFacts,
  principal: TabPrincipal,
  authorize: (input: AuthorizationInput) => AuthorizationDecision,
): LeagueRoomsRead | null {
  const lobby = facts.standingLobby;
  if (!facts.authorization.organization) return null;
  const hosted = hostLobbyResource(
    lobby,
    facts.authorization.organization,
    null,
  );
  if (hosted.kind !== 'lobby') return null;
  const posting = resolveSetting(
    'audience.posting',
    roomChain({
      organizationId: facts.organization.id,
      lobbyId: lobby.id,
      templateId: null,
    }),
    facts.standingPostingSettings.map(settingRow),
  ).value;
  const resource = {
    ...hosted,
    viewing: {
      audiences:
        facts.authorization.membership === 'active'
          ? ['participants' as const]
          : [],
      releases: [],
    },
    postingAudiences: releaseAudiences.filter(
      (audience) => posting[audience] !== 'never',
    ),
  };
  const ask = (capability: AuthorizationInput['capability']) =>
    authorize({
      principal,
      resource,
      context: {
        account: facts.authorization.account,
        grants: facts.authorization.grants,
        now: facts.now,
      },
      capability,
    }).allow;
  if (!ask('room.list')) return null;
  const rows = facts.standingRooms.map((room) => {
    const people = facts.standingParticipants.filter(
      (person) => person.roomId === room.id,
    );
    const own = people.find((person) => person.actorId === principal.actorId);
    const round = facts.standingRounds.find(
      (round) => round.roomId === room.id && isRoundRunning(round.status),
    );
    const debaters = Math.max(
      0,
      seatsOfKind(room.rulesSnapshot, 'side') +
        seatsOfKind(room.rulesSnapshot, 'speaker') -
        people.filter(
          (person) =>
            person.seatKind === 'side' || person.seatKind === 'speaker',
        ).length,
    );
    const judges = Math.max(
      0,
      room.rulesSnapshot.seats.judges -
        people.filter((person) => person.seatKind === 'judge').length,
    );
    const role = own
      ? own.seatKind === 'judge'
        ? 'You are judging'
        : own.seatKind === 'moderator'
          ? 'You are moderating'
          : 'You are debating'
      : null;
    const href =
      own && round ? `/rounds/${round.id}/room` : `/rooms/${room.id}`;
    return {
      own: !!own,
      live: !!round,
      title: room.title,
      detail: [
        room.formatId,
        role,
        round
          ? 'Live'
          : room.status === 'ready'
            ? 'Ready'
            : room.status === 'started'
              ? 'Round over'
              : null,
        debaters
          ? `${debaters} debater ${debaters === 1 ? 'seat' : 'seats'} open`
          : null,
        judges
          ? `${judges} judge ${judges === 1 ? 'seat' : 'seats'} open`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
      action: linkTo(
        own
          ? 'Return to room'
          : !round && debaters
            ? 'Join'
            : !round && judges
              ? 'Judge'
              : 'Open',
        href,
        !!own,
      ),
    };
  });
  const groups = [
    { heading: 'Your room', rooms: rows.filter((row) => row.own) },
    { heading: 'Open', rooms: rows.filter((row) => !row.own && !row.live) },
    { heading: 'Live now', rooms: rows.filter((row) => !row.own && row.live) },
  ]
    .filter((group) => group.rooms.length)
    .map((group) => ({
      heading: group.heading,
      rooms: group.rooms.map(({ title, detail, action }) => ({
        title,
        detail,
        action,
      })),
    }));
  const settings: SettingLine[] = (
    [
      ['room.visibility', 'Room visibility'],
      ['room.own_format', 'Custom formats'],
    ] as const
  ).map(([key, label]) => {
    const resolved = resolveSetting(
      key,
      roomChain({
        organizationId: facts.organization.id,
        lobbyId: lobby.id,
        templateId: null,
      }),
      facts.standingPostingSettings.map(settingRow),
    );
    const source =
      resolved.source.kind === 'organization'
        ? { scope: 'organization' as const, name: facts.organization.name }
        : resolved.source.kind === 'lobby'
          ? { scope: 'lobby' as const, name: lobby.name }
          : { scope: 'daisy' as const, name: 'Daisy' };
    return {
      keys: [key],
      label,
      value: resolved.value.value,
      source,
      control: openSetting(null, resolved.hold),
      attention: null,
    };
  });
  return {
    settings,
    canCreate: lobby.closedAt === null && ask('lobby.room.create'),
    panel: {
      kind: 'rooms',
      pool: { title: lobby.name, detail: '' },
      groups,
      note: rows.length ? '' : 'No open rooms',
    },
  };
}
