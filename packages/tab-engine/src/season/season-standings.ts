import { compareBytes } from '@daisy/seeded-random';
import type { FormatDescriptor, Id, StageHistory } from '../shapes/competition';
import type {
  SeasonEvent,
  SeasonFormula,
  SeasonStandings,
} from '../shapes/folds';
import { effectiveResults } from '../standings/effective-results';
import { entriesOf } from '../standings/games';

type Exception = SeasonStandings['exceptions'][number];
type EventPoints = { readonly event: Id; readonly points: number };

/** The latest correction of every result, kept only when it is certified. */
const certified = (history: StageHistory<FormatDescriptor>) =>
  effectiveResults(history, Number.POSITIVE_INFINITY).filter(
    (r) => r.certified,
  );

const preliminaryPoints = (
  event: SeasonEvent,
  entry: Id,
  formula: SeasonFormula,
) => {
  const wins = certified(event.preliminary).filter(
    (r) => r.outcome.kind === 'winner' && r.outcome.winner === entry,
  ).length;
  const points = wins * formula.preliminaryWin.points;
  return formula.preliminaryWin.cap === null
    ? points
    : Math.min(points, formula.preliminaryWin.cap);
};

/** Distinct elimination tab rounds the entry stood in: a certified result's fixture, or a bye. */
const eliminationRounds = (event: SeasonEvent, entry: Id) => {
  const history: StageHistory<FormatDescriptor> = event.elimination;
  const decided = new Set(certified(history).map((r) => r.fixture));
  return new Set(
    history.fixtures
      .filter(
        (f) =>
          entriesOf(f.fixture).includes(entry) &&
          (f.fixture.kind === 'bye' || decided.has(f.id)),
      )
      .map((f) => f.tabRound),
  ).size;
};

const foldEvent = (event: SeasonEvent, formula: SeasonFormula) => {
  const points = new Map<Id, number>();
  const exceptions: Exception[] = [];
  const competitors = [...new Set(event.entries.map((e) => e.competitor))].sort(
    compareBytes,
  );
  const twoSided = event.format.outcome === 'winner';
  for (const competitor of competitors) {
    const entries = event.entries.filter((e) => e.competitor === competitor);
    if (entries.length > 1) {
      for (const term of ['preliminary_win', 'elimination_round'] as const)
        exceptions.push({
          competitor,
          event: event.event,
          term,
          reason: 'competitor_twice_in_event',
        });
      continue;
    }
    const entry = entries[0]!.entry;
    if (!twoSided && formula.preliminaryWin.points > 0)
      exceptions.push({
        competitor,
        event: event.event,
        term: 'preliminary_win',
        reason: 'no_winner_in_format',
      });
    points.set(
      competitor,
      (twoSided ? preliminaryPoints(event, entry, formula) : 0) +
        eliminationRounds(event, entry) * formula.eliminationRound.points,
    );
  }
  return { points, exceptions };
};

const best = (events: readonly EventPoints[], count: number | null) => {
  if (count === null) return events;
  const kept = new Set(
    [...events]
      .sort((a, b) => b.points - a.points || compareBytes(a.event, b.event))
      .slice(0, count),
  );
  return events.filter((e) => kept.has(e));
};

/**
 * A league's season standings: only sanctioned events, only certified
 * results (the latest correction of each). Each event scores preliminary
 * wins (capped) and elimination rounds reached; a term the format cannot
 * evaluate is an exception row, never a guess. With `bestEvents`, the best
 * K event totals count. With `topPerSchool`, only each school's top M
 * competitors are listed; a competitor's school is the one of their entry in
 * the last sanctioned event, in input order, that lists them (a competitor
 * with no school is never limited).
 */
export const SEASON_VERSION = 'season-standings@1';

export const seasonStandings = (
  events: readonly SeasonEvent[],
  formula: SeasonFormula,
): SeasonStandings => {
  const byCompetitor = new Map<Id, EventPoints[]>();
  const school = new Map<Id, Id | null>();
  const exceptions: Exception[] = [];
  for (const event of events.filter((e) => e.sanctioned)) {
    const folded = foldEvent(event, formula);
    exceptions.push(...folded.exceptions);
    for (const e of event.entries) {
      school.set(e.competitor, e.school);
      if (!byCompetitor.has(e.competitor)) byCompetitor.set(e.competitor, []);
    }
    for (const [competitor, points] of folded.points)
      byCompetitor.get(competitor)!.push({ event: event.event, points });
  }
  const rows = [...byCompetitor]
    .map(([competitor, all]) => {
      const kept = best(all, formula.bestEvents);
      return {
        competitor,
        points: kept.reduce((s, e) => s + e.points, 0),
        events: kept,
      };
    })
    .sort(
      (a, b) => b.points - a.points || compareBytes(a.competitor, b.competitor),
    );
  const listed = new Map<Id, number>();
  return {
    rows: rows.filter(({ competitor }) => {
      const of = school.get(competitor) ?? null;
      if (formula.topPerSchool === null || of === null) return true;
      listed.set(of, (listed.get(of) ?? 0) + 1);
      return listed.get(of)! <= formula.topPerSchool;
    }),
    exceptions,
  };
};
