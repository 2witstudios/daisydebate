import { eventFixtureAudiences } from '../event-room-direction';
import { isRoundRunning } from '@daisy/protocol';
import { showTournamentEntrant } from '../shown-entrant';
import { authorize, visibleThing } from '@daisy/auth/authorization';
import type {
  EventCompetitionFacts,
  ParticipantFixtureFacts,
  TabStore,
} from '@daisy/db/tab';
import { bracketViewSchema } from '@daisy/protocol/lobby/standings-read';
import type { ReleaseThing } from '@daisy/protocol/release-audience';
import { projectResultCompetition } from '../commands/result-projection';
import { standingsViewOf } from './host-standings';
import type { TabPrincipal } from '../tab-principal';
import { tournamentAudience } from './participant-tournament';
import { drawStageSnapshotSchema } from '../operations/draw-facts';

type FixtureRoom = ParticipantFixtureFacts['rows'][number];

function releasedBracket(
  facts: EventCompetitionFacts,
  posted: (fixture: EventCompetitionFacts['fixtures'][number]) => boolean,
  visible: (
    fixture: EventCompetitionFacts['fixtures'][number],
    thing: ReleaseThing,
  ) => boolean,
  startTimes: ReadonlyMap<string | null, Date | null>,
  allowNames: boolean,
  fixtureRooms: ReadonlyMap<string, FixtureRoom>,
) {
  const entries = new Map(facts.entries.map((entry) => [entry.id, entry]));
  const superseded = new Set(
    facts.results.map((result) => result.supersedesResultId),
  );
  const latest = new Map(
    facts.results
      .filter((result) => !superseded.has(result.id))
      .map((result) => [result.fixtureId, result]),
  );
  return facts.stages
    .filter((stage) => stage.kind === 'elimination')
    .map((stage) => {
      const stageRounds = facts.rounds.filter(
        (round) => round.stageId === stage.id,
      );
      const firstDraw = stageRounds
        .flatMap((round) =>
          facts.draws.filter(
            (draw) =>
              draw.tabRoundId === round.id && draw.status === 'published',
          ),
        )
        .at(0);
      const snapshot = drawStageSnapshotSchema.safeParse(
        firstDraw?.inputs.stage,
      );
      const seeds = new Map(
        snapshot.success && snapshot.data.kind === 'elimination'
          ? snapshot.data.bracket.seeds.map(
              (id, index) => [id, index + 1] as const,
            )
          : [],
      );
      return bracketViewSchema.parse({
        visibility: 'audience',
        lobbyId: stage.lobbyId,
        eventId: stage.eventId,
        stageId: stage.id,
        kind: 'elimination',
        division: stage.division,
        tabRounds: stageRounds.map((round) => {
          const published = facts.fixtures.filter(
            (fixture) =>
              fixture.tabRoundId === round.id && fixture.status === 'published',
          );
          const fixtures = published.filter(
            (fixture) => posted(fixture) || visible(fixture, 'decision'),
          );
          const running = published.some((fixture) => {
            const status = fixtureRooms.get(fixture.id)?.roundStatus;
            return status ? isRoundRunning(status) : false;
          });
          return {
            tabRoundId: round.id,
            name: round.name ?? `Round ${round.number}`,
            status:
              fixtures.length > 0 &&
              published.every((fixture) => latest.has(fixture.id)) &&
              fixtures.some((fixture) => visible(fixture, 'decision'))
                ? 'complete'
                : fixtures.length && running
                  ? 'running'
                  : 'scheduled',
            startsAt: startTimes.get(round.id)?.toISOString() ?? null,
            waitsOn: null,
            fixtures: fixtures.map((fixture) => {
              const result = visible(fixture, 'decision')
                ? latest.get(fixture.id)
                : null;
              const projection = result
                ? projectResultCompetition(result.competitionRecord, {
                    id: result.id,
                    fixture: fixture.id,
                    supersedes: result.supersedesResultId,
                    certified: facts.certified.some(
                      (certificate) => certificate.resultId === result.id,
                    ),
                  })
                : null;
              const room = fixtureRooms.get(fixture.id);
              return {
                fixtureId: fixture.id,
                entries: facts.fixtureEntries
                  .filter((entry) => entry.fixtureId === fixture.id)
                  .sort((a, b) => a.position - b.position)
                  .map(({ entryId }) => ({
                    entryId,
                    seed: seeds.get(entryId) ?? null,
                    shown: showTournamentEntrant(
                      entries.get(entryId)?.name ?? 'Entry',
                      allowNames,
                    ),
                  })),
                state:
                  result && projection?.kind === 'projected'
                    ? {
                        kind: 'decided',
                        resultId: result.id,
                        outcomes: projection.projection.entries,
                      }
                    : latest.has(fixture.id)
                      ? { kind: 'withheld' }
                      : room?.roomId &&
                          room.roundStatus &&
                          isRoundRunning(room.roundStatus)
                        ? {
                            kind: 'live',
                            room: {
                              roomId: room.roomId,
                              name: allowNames
                                ? (room.roomName ?? 'Room')
                                : 'Room',
                            },
                            watchable: false,
                          }
                        : room?.roundStatus
                          ? { kind: 'awaiting_result' }
                          : { kind: 'scheduled' },
              };
            }),
          };
        }),
      });
    });
}

export async function readParticipantResults(
  store: Pick<TabStore, 'participantEventResults'>,
  principal: TabPrincipal,
  input: { readonly lobbyId: string; readonly eventId: string },
  section: 'standings' | 'bracket',
  watchable?: (roomId: string) => Promise<boolean>,
) {
  if (!principal.actorId) return null;
  const result = await store.participantEventResults(
    {
      ...input,
      viewerUserId: principal.userId,
      viewerActorId: principal.actorId,
    },
    async (tournament, facts, schedule, fixtureAudience, readFixtures) => {
      const audience = tournamentAudience(tournament, principal);
      if (
        !audience ||
        (!audience.host && tournament.tournament.status === 'draft')
      )
        return null;
      const audiencesByFixture = new Map<
        string,
        ReturnType<typeof eventFixtureAudiences>
      >();
      for (const fixture of facts.fixtures.filter(
        (row) => row.status === 'published',
      )) {
        const eligible = await fixtureAudience(fixture);
        audiencesByFixture.set(
          fixture.id,
          eventFixtureAudiences(
            {
              authorization: facts.authorization,
              audience: eligible,
            },
            tournament.checkedAt,
          ),
        );
      }
      const releaseFor = (roundId: string) =>
        tournament.openings.filter((opening) => opening.tabRoundId === roundId);
      const visible = (
        fixture: Pick<
          EventCompetitionFacts['fixtures'][number],
          'id' | 'tabRoundId'
        >,
        thing: ReleaseThing,
      ) =>
        visibleThing(
          thing,
          {
            audiences: audiencesByFixture.get(fixture.id) ?? audience.audiences,
            releases: releaseFor(fixture.tabRoundId),
          },
          null,
        );
      const posted = (fixture: EventCompetitionFacts['fixtures'][number]) =>
        authorize({
          ...audience.base,
          capability: 'posting.read',
          resource: {
            kind: 'draw',
            scope: audience.scope,
            viewing: {
              audiences:
                audiencesByFixture.get(fixture.id) ?? audience.audiences,
              releases: releaseFor(fixture.tabRoundId),
            },
          },
        }).allow;
      const official = authorize({
        ...audience.base,
        resource: audience.resource,
        capability: 'lobby.host.results.read',
      }).allow;
      if (
        !audience.canRead &&
        !official &&
        !facts.fixtures.some(
          (fixture) =>
            fixture.status === 'published' &&
            (visible(fixture, 'decision') ||
              (section === 'bracket' && posted(fixture))),
        )
      )
        return null;
      const address = {
        name: tournament.lobby.name,
        tournamentReadable: audience.canRead,
        events: [
          ...new Map(
            schedule
              .filter(
                (row) => audience.canRead || row.eventId === input.eventId,
              )
              .map((row) => [row.eventId, row.event] as const),
          ),
        ].map(([id, label]) => ({ id, label })),
      };
      const allowNames = official || audience.audiences.length > 0;
      if (section === 'bracket') {
        const elimination = new Set(
          facts.stages
            .filter((stage) => stage.kind === 'elimination')
            .map((stage) => stage.id),
        );
        const fixtureRooms = new Map<string, FixtureRoom>();
        for (const round of facts.rounds.filter((row) =>
          elimination.has(row.stageId),
        )) {
          const { rows } = await readFixtures(round.id);
          for (const room of rows) fixtureRooms.set(room.fixtureId, room);
        }
        return {
          kind: 'bracket' as const,
          ...address,
          brackets: releasedBracket(
            facts,
            posted,
            (fixture, thing) => official || visible(fixture, thing),
            new Map(schedule.map((row) => [row.roundId, row.startsAt])),
            allowNames,
            fixtureRooms,
          ),
        };
      }
      const preliminary = new Set(
        facts.stages
          .filter((stage) => stage.kind === 'preliminary')
          .map((stage) => stage.id),
      );
      const preliminaryRounds = new Set(
        facts.rounds
          .filter((round) => preliminary.has(round.stageId))
          .map((round) => round.id),
      );
      const released = facts.results.filter(
        (row) =>
          preliminaryRounds.has(row.tabRoundId) &&
          visible(
            { id: row.fixtureId, tabRoundId: row.tabRoundId },
            'decision',
          ),
      );
      const rounds = new Set(released.map((row) => row.tabRoundId));
      const broadDecisions = released.every((row) =>
        visibleThing(
          'decision',
          {
            audiences: audience.audiences,
            releases: releaseFor(row.tabRoundId),
          },
          null,
        ),
      );
      const releasedFixtures = new Set(released.map((row) => row.fixtureId));
      const releasedEntrants = new Set(
        facts.fixtureEntries
          .filter((row) => releasedFixtures.has(row.fixtureId))
          .map((row) => row.entryId),
      );
      const standings = official
        ? standingsViewOf(facts, {
            kind: 'official',
            capabilities: { announceBreak: false, previewCorrection: false },
          })
        : released.length
          ? standingsViewOf(
              {
                ...facts,
                entries: broadDecisions
                  ? facts.entries
                  : facts.entries.filter((entry) =>
                      releasedEntrants.has(entry.id),
                    ),
                results: released,
                rounds: facts.rounds.filter((round) => rounds.has(round.id)),
              },
              {
                kind: released.every((row) =>
                  visible(
                    { id: row.fixtureId, tabRoundId: row.tabRoundId },
                    'scores',
                  ),
                )
                  ? 'released_with_scores'
                  : 'released_decisions',
                allowNames,
              },
            )
          : null;
      return { kind: 'standings' as const, standings, ...address };
    },
  );
  if (result?.kind === 'bracket' && watchable) {
    for (const bracket of result.brackets)
      for (const round of bracket.tabRounds)
        for (const fixture of round.fixtures)
          if (fixture.state.kind === 'live')
            fixture.state.watchable = await watchable(
              fixture.state.room.roomId,
            );
  }
  return result;
}
