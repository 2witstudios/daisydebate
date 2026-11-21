import { showTournamentEntrant } from '../shown-entrant';
import { eventResultsVersion } from '../operations/event-results-version';
import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import type { EventCompetitionFacts, TabStore } from '@daisy/db/tab';
import { idSchema } from '@daisy/protocol';
import { resultCompetitionRecordSchema } from '@daisy/protocol/lobby/result-record';
import {
  standingsViewSchema,
  type StandingsView,
} from '@daisy/protocol/lobby/standings-read';
import { standings } from '@daisy/tab-engine';
import { eventBreaks } from '../operations/event-breaks';
import { hostResultsAuthority } from '../operations/host-results-authority';
import { eventCompetition } from '../operations/event-competition';
import type { TabPrincipal } from '../tab-principal';

export function standingsViewOf(
  facts: EventCompetitionFacts,
  access:
    | {
        readonly kind: 'official';
        readonly capabilities: {
          readonly announceBreak: boolean;
          readonly previewCorrection: boolean;
        };
      }
    | { readonly kind: 'released_with_scores'; readonly allowNames: boolean }
    | { readonly kind: 'released_decisions'; readonly allowNames: boolean },
): StandingsView {
  const preliminary = facts.stages.filter(
    (stage) => stage.kind === 'preliminary',
  );
  const rounds = facts.rounds.filter((round) =>
    preliminary.some((stage) => stage.id === round.stageId),
  );
  const cutoff = Math.max(1, ...rounds.map((round) => round.number));
  const competition = eventCompetition(facts, {
    stageIds: preliminary.map((stage) => stage.id),
    cutoff,
    division: null,
    seed: new TextEncoder().encode(facts.configuration.event.id),
  });
  const input =
    access.kind === 'released_decisions'
      ? {
          ...competition,
          settings: {
            ...competition.settings,
            'standings.tiebreaks': {
              ...competition.settings['standings.tiebreaks'],
              metrics: ['wins', 'opponent_wins'] as const,
            },
          },
        }
      : competition;
  const folded = standings(input);
  const metrics = standings({
    ...input,
    settings: {
      ...input.settings,
      'standings.tiebreaks': {
        ...input.settings['standings.tiebreaks'],
        metrics: ['wins', 'total_points', 'opponent_wins'],
      },
    },
  });
  const computedBreak =
    access.kind === 'official' ? eventBreaks(facts).answer : null;
  const firstBreak =
    computedBreak?.kind === 'resolved' ? computedBreak.stages[0] : null;
  const firstRound = facts.rounds.find(
    (round) => round.stageId === firstBreak?.stage,
  );
  const latest = facts.results.filter(
    (row) =>
      !facts.results.some((other) => other.supersedesResultId === row.id),
  );
  const published = facts.fixtures.filter(
    (row) =>
      row.status === 'published' &&
      rounds.some((round) => round.id === row.tabRoundId),
  );
  const complete =
    published.length > 0 &&
    published.every((fixture) =>
      latest.some((row) => row.fixtureId === fixture.id),
    );
  const records = facts.results.map((row) =>
    resultCompetitionRecordSchema.parse(row.competitionRecord),
  );
  const unit = records.find((row) => row.pointUnit)?.pointUnit;
  const scale = unit ? Number(unit.numerator) / Number(unit.denominator) : 1;
  return standingsViewSchema.parse({
    lobbyId: facts.configuration.lobby.id,
    eventId: facts.configuration.event.id,
    division: null,
    throughRound: cutoff,
    progress: complete
      ? {
          kind: 'complete',
          ballots: records
            .filter((row) =>
              folded.results.includes(facts.results[records.indexOf(row)]!.id),
            )
            .reduce(
              (n, row) =>
                n +
                (row.kind === 'decided'
                  ? row.panel.filter(
                      (judge) => judge.ballot.kind === 'submitted',
                    ).length
                  : 0),
              0,
            ),
        }
      : { kind: 'running', tabRoundNumber: cutoff },
    tiebreaks: input.settings['standings.tiebreaks'].metrics,
    breakLine:
      firstBreak && firstRound && firstBreak.bracket.seeds.length
        ? {
            seeds: firstBreak.bracket.seeds.length,
            tabRoundName: firstRound.name,
          }
        : null,
    breakAnnouncedAt: facts.announcements[0]?.appliedAt.toISOString() ?? null,
    entryCount: folded.rows.length,
    visibility: access.kind,
    ...(access.kind === 'official'
      ? {
          resultsVersion: eventResultsVersion(facts),
          capabilities: access.capabilities,
        }
      : {}),
    rows: folded.rows.map((row, i) => {
      const entry = facts.entries.find((entry) => entry.id === row.entry)!;
      const values = metrics.rows.find(
        (one) => one.entry === row.entry,
      )!.values;
      const value = (metric: 'wins' | 'total_points' | 'opponent_wins') =>
        values
          .find((one) => one.metric === metric)!
          .value.reduce((sum, fraction) => sum + fraction.n / fraction.d, 0);
      const rating = input.ratings?.entries.find(
        (one) => one.entry === entry.id,
      );
      return {
        seed: i + 1,
        entry: {
          entryId: entry.id,
          shown: showTournamentEntrant(
            entry.name,
            access.kind === 'official' || access.allowNames,
          ),
        },
        responsible: { kind: entry.responsibleKind, name: null },
        wins: value('wins'),
        opponentWins: value('opponent_wins'),
        ...(access.kind === 'released_decisions'
          ? {}
          : { points: value('total_points') * scale }),
        rating:
          access.kind === 'official' && rating?.status === 'rated'
            ? rating.rating
            : null,
        explanation: row.separatedBy ?? 'First in the standings',
        decidesBreak: firstBreak?.bracket.seeds.length === i + 1,
      };
    }),
  });
}

export const readHostStandings =
  (dependencies: {
    readonly store: Pick<TabStore, 'eventCompetition'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly now: () => string;
  }) =>
  async (
    principal: TabPrincipal,
    input: { readonly lobbyId: string; readonly eventId: string },
  ): Promise<StandingsView | null> => {
    if (
      !idSchema.safeParse(input.lobbyId).success ||
      !idSchema.safeParse(input.eventId).success
    )
      return null;
    return dependencies.store.eventCompetition(
      { ...input, viewerUserId: principal.userId },
      async (facts) => {
        if (!facts) return null;
        const authority = hostResultsAuthority(
          facts,
          principal,
          dependencies.now(),
        );
        const ask = (capability: AuthorizationInput['capability']) =>
          dependencies.authorize({ ...authority, capability }).allow;
        if (!ask('lobby.host.results.read')) return null;
        return standingsViewOf(facts, {
          kind: 'official',
          capabilities: {
            announceBreak: ask('tournament.results.release'),
            previewCorrection: ask('tournament.results.enter'),
          },
        });
      },
    );
  };
