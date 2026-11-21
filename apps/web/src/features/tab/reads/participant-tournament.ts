import { eventFixtureAudiences } from '../event-room-direction';
import { shownName, showTournamentEntrant } from '../shown-entrant';
import { isOpenRoomStatus, isRoundRunning } from '@daisy/protocol';
import { eventSettingResolution } from '../operations/event-setting-resolution';
import { authorize } from '@daisy/auth/authorization';
import type {
  ParticipantFixtureFacts,
  ParticipantTournamentFacts,
  TabStore,
} from '@daisy/db/tab';
import { releaseAudiences } from '@daisy/protocol/release-audience';
import { resolveSetting } from '@daisy/protocol/setting-resolution';
import { hostLobbyResource } from '../operations/host-lobby-resource';
import { settingRow } from '../operations/setting-facts';
import type { TabPrincipal } from '../tab-principal';

export function tournamentAudience(
  facts: ParticipantTournamentFacts,
  principal: TabPrincipal,
  byAddress = true,
) {
  const { lobby, authorization, checkedAt } = facts;
  const resource = hostLobbyResource(
    lobby,
    authorization.organization,
    facts.ownerActorId,
  );
  if (resource.kind !== 'lobby' || resource.scope.lobbyKind !== 'tournament')
    return null;
  const participant =
    facts.enrolled.some((entry) => entry.status === 'accepted') ||
    facts.judge?.status === 'accepted';
  const posting = resolveSetting(
    'audience.posting',
    [
      ...(lobby.ownerOrganizationId
        ? [{ kind: 'organization' as const, id: lobby.ownerOrganizationId }]
        : []),
      { kind: 'lobby', id: lobby.id },
    ],
    facts.posting.map(settingRow),
  ).value;
  const base = {
    principal,
    context: {
      account: authorization.account,
      grants: authorization.grants,
      now: checkedAt,
    },
  };
  const host = authorize({
    ...base,
    resource,
    capability: 'lobby.host.read',
  }).allow;
  const audiences = participant ? ['participants' as const] : [];
  const configured = releaseAudiences.filter(
    (audience) =>
      (byAddress || audience !== 'link') &&
      (posting[audience] !== 'never' ||
        facts.openings.some(
          (opening) =>
            opening.thing === 'posting' && opening.audience === audience,
        )),
  );
  return {
    base,
    resource,
    scope: resource.scope,
    host,
    audiences,
    canRead: authorize({
      ...base,
      capability: 'lobby.read',
      resource: {
        ...resource,
        postingAudiences: configured,
        viewing: { audiences, releases: [] },
      },
    }).allow,
  };
}

function projectFixtures(
  { rows, sides, judges }: ParticipantFixtureFacts,
  actorId: string | null,
  accepted: ReadonlySet<string>,
  namesAllowed: (fixtureId: string) => boolean,
) {
  return rows.map(({ roomStatus, roundStatus, roundStage, ...fixture }) => {
    const allowNames = namesAllowed(fixture.fixtureId);
    const entries = sides.filter(
      (side) => side.fixtureId === fixture.fixtureId,
    );
    const assigned = judges.filter(
      (judge) => judge.fixtureId === fixture.fixtureId,
    );
    const judging = assigned.some((judge) => judge.actorId === actorId);
    const live = roundStatus !== null && isRoundRunning(roundStatus);
    return {
      ...fixture,
      roomName: allowNames ? fixture.roomName : null,
      live,
      watchable: false,
      waiting: roomStatus !== null && isOpenRoomStatus(roomStatus),
      ballotDue: live && roundStage === 'awaiting_ballot' && judging,
      own: judging || entries.some((entry) => accepted.has(entry.entryId)),
      judges: assigned.flatMap((judge) =>
        judge.name
          ? [shownName(showTournamentEntrant(judge.name, allowNames))]
          : [],
      ),
      entries: entries.map((entry) =>
        shownName(showTournamentEntrant(entry.name, allowNames)),
      ),
    };
  });
}

export function readPublicTournamentPosting(
  store: Pick<TabStore, 'publicTournamentPosting'>,
  input: {
    readonly lobbyId: string;
    readonly eventId: string;
    readonly roundId: string;
  },
) {
  return store.publicTournamentPosting(
    input,
    (address, schedule, fixtures) => ({
      ...address,
      tournamentReadable: false,
      selected: {
        round: schedule.round,
        number: schedule.number,
        event: schedule.event,
        resolution: schedule.resolution,
        fixtures: projectFixtures(fixtures, null, new Set(), () => false),
      },
    }),
  );
}

export async function readParticipantTournament(
  store: Pick<TabStore, 'participantTournament'>,
  principal: TabPrincipal,
  lobbyId: string,
  round: { readonly eventId: string; readonly roundId: string } | null,
  watchable?: (roomId: string) => Promise<boolean>,
) {
  const actorId = principal.actorId;
  if (!actorId) return null;
  const view = await store.participantTournament(
    {
      lobbyId,
      viewerUserId: principal.userId,
      viewerActorId: principal.actorId,
    },
    async (facts, schedule, readFixtures, eventSettings, fixtureAudience) => {
      const audience = tournamentAudience(facts, principal);
      if (
        !audience ||
        (!audience.canRead && !round) ||
        (!audience.host && facts.tournament.status === 'draft')
      )
        return null;
      const drawOfficial = authorize({
        ...audience.base,
        resource: audience.resource,
        capability: 'lobby.host.draw.read',
      }).allow;
      const accepted = new Set(
        facts.enrolled
          .filter((entry) => entry.status === 'accepted')
          .map((entry) => entry.entryId),
      );
      const ownRooms = [];
      const rows = [];
      let selected = null;
      for (const {
        startsAt,
        resolution,
        published,
        ...row
      } of await schedule()) {
        const addressed =
          round?.eventId === row.eventId && round?.roundId === row.roundId;
        if (round && !addressed) continue;
        const releases = facts.openings.filter(
          (opening) =>
            opening.tabRoundId === row.roundId && opening.thing === 'posting',
        );
        const canReadPosting = (
          audiences: ReturnType<typeof eventFixtureAudiences>,
        ) =>
          authorize({
            ...audience.base,
            capability: 'posting.read',
            resource: {
              kind: 'draw',
              scope: audience.scope,
              viewing: { audiences, releases },
            },
          }).allow;
        const broad = published && canReadPosting(audience.audiences);
        const relatedOnly =
          !broad &&
          releases.some(
            ({ audience }) =>
              audience === 'competitors' || audience === 'responsible_adults',
          );
        const visible = new Map<string, boolean>();
        let fixtures: ParticipantFixtureFacts | null = null;
        if (
          published &&
          row.roundId &&
          (relatedOnly ||
            (broad &&
              (addressed ||
                accepted.size ||
                facts.judge?.status === 'accepted')))
        ) {
          fixtures = await readFixtures(row.roundId);
          for (const fixture of fixtures.rows) {
            const relationships = relatedOnly
              ? eventFixtureAudiences(
                  {
                    authorization: facts.authorization,
                    audience: await fixtureAudience(
                      fixture.fixtureId,
                      row.roundId,
                    ),
                  },
                  facts.checkedAt,
                )
              : audience.audiences;
            if (broad || canReadPosting(relationships))
              visible.set(
                fixture.fixtureId,
                drawOfficial || relationships.length > 0,
              );
          }
        }
        const summary = {
          ...row,
          startsAt: startsAt?.toISOString() ?? null,
          posted: broad || visible.size > 0,
          resolution: null,
        };
        rows.push(summary);
        const projected = fixtures
          ? projectFixtures(
              {
                ...fixtures,
                rows: fixtures.rows.filter((fixture) =>
                  visible.has(fixture.fixtureId),
                ),
              },
              actorId,
              accepted,
              (fixtureId) => visible.get(fixtureId) ?? false,
            )
          : [];
        if (addressed && summary.posted)
          selected = { ...summary, resolution, fixtures: projected };
        if (!round)
          ownRooms.push(
            ...projected
              .filter(
                (fixture) =>
                  fixture.own &&
                  fixture.roomId &&
                  (fixture.waiting || fixture.live),
              )
              .map((fixture) => ({ ...fixture, round: summary })),
          );
      }
      if (round && !selected) return null;
      const canSubmit =
        !round &&
        authorize({
          ...audience.base,
          capability: 'entry.submit',
          resource: {
            kind: 'entry',
            scope: audience.scope,
            responsible: { kind: 'self', actorId },
          },
        }).allow;
      const registration = [];
      if (canSubmit) {
        const uniqueEvents = new Map(rows.map((row) => [row.eventId, row]));
        for (const row of uniqueEvents.values()) {
          if (
            row.entryKind !== 'person' ||
            facts.enrolled.some((entry) => entry.eventId === row.eventId)
          )
            continue;
          const configuration = await eventSettings(row.eventId);
          if (!configuration) continue;
          const { settings } = eventSettingResolution(configuration);
          const state = settings['entry.registration'].value;
          const open =
            state.state === 'open' ||
            (state.state === 'window' &&
              state.opensAt <= facts.checkedAt &&
              facts.checkedAt < state.closesAt);
          if (!open) continue;
          registration.push({
            eventId: row.eventId,
            name: row.event,
            expected: configuration.event.entriesVersion,
            divisions: settings['entry.divisions'].value.items,
          });
        }
      }
      return {
        id: facts.lobby.id,
        name: facts.lobby.name,
        handle: facts.lobby.handle,
        status: facts.tournament.status,
        host: audience.host,
        tournamentReadable: audience.canRead,
        entries: facts.enrolled,
        registration,
        actorId,
        schedule: rows,
        ownRooms,
        selected,
      };
    },
  );
  if (view?.selected && watchable) {
    for (const fixture of view.selected.fixtures)
      if (fixture.live && fixture.roomId && !fixture.own)
        fixture.watchable = await watchable(fixture.roomId);
  }
  return view;
}

export async function readTournamentDirectory(
  store: Pick<TabStore, 'participantTournament' | 'tournamentDirectory'>,
  principal: TabPrincipal,
  after: string,
) {
  if (!principal.actorId) return null;
  const pageSize = 24;
  const input = {
    viewerUserId: principal.userId,
    viewerActorId: principal.actorId,
  };
  const visible: {
    handle: string;
    name: string;
    status: ParticipantTournamentFacts['tournament']['status'];
  }[] = [];
  const candidates = await store.tournamentDirectory(after, pageSize + 1);
  const scanned = candidates.slice(0, pageSize);
  for (const candidate of scanned) {
    const row = await store.participantTournament(
      { ...input, lobbyId: candidate.id },
      async (facts) => {
        const audience = tournamentAudience(facts, principal, false);
        if (!audience?.canRead || facts.tournament.status === 'draft')
          return null;
        return {
          handle: facts.lobby.handle,
          name: facts.lobby.name,
          status: facts.tournament.status,
        };
      },
    );
    if (row) visible.push(row);
  }
  return {
    rows: visible,
    next: candidates.length > pageSize ? (scanned.at(-1)?.id ?? null) : null,
  };
}
