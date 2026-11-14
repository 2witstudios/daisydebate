import type { Id } from '../shapes/competition';
import type {
  BreaksAnswer,
  BreaksInput,
  Standings,
  StandingsInput,
} from '../shapes/folds';
import { resultsDifference } from './record';
import { verdictOf, type Verdict, type Violation } from './verdict';

/** A standings table names known entries once each, ranks down the table, and counts exactly the counted results. */
export const checkStandings = (
  input: StandingsInput,
  standings: Standings,
): Verdict => {
  const violations: Violation[] = [];
  const entries = new Map(input.entries.map((e) => [e.id, e]));
  const seen = new Set<Id>();
  let lastRank: number | null = null;
  let unrankedSeen = false;
  for (const row of standings.rows) {
    const entry = entries.get(row.entry);
    if (entry === undefined)
      violations.push({ kind: 'standings_entry_unknown', entry: row.entry });
    else if (input.division !== null && entry.division !== input.division)
      violations.push({
        kind: 'standings_division',
        entry: row.entry,
        division: input.division,
      });
    if (seen.has(row.entry))
      violations.push({ kind: 'standings_entry_twice', entry: row.entry });
    seen.add(row.entry);
    if (row.rank === null) {
      unrankedSeen = true;
      continue;
    }
    if (unrankedSeen || (lastRank !== null && row.rank < lastRank))
      violations.push({
        kind: 'standings_rank_order',
        entry: row.entry,
        rank: row.rank,
      });
    lastRank = row.rank;
  }
  const results = resultsDifference(input, input.cutoff, standings.results);
  if (results.missing.length > 0 || results.extra.length > 0)
    violations.push({ kind: 'standings_results', ...results });
  return verdictOf(violations);
};

/** A break places only eligible entries of each stage's division, and honours the double-qualifier policy. */
export const checkBreaks = (
  input: BreaksInput,
  answer: BreaksAnswer,
): Verdict => {
  const violations: Violation[] = [];
  switch (answer.kind) {
    case 'undecided':
      for (const { entry } of answer.entries) {
        const choice = Object.hasOwn(input.choices, entry)
          ? input.choices[entry]
          : undefined;
        if (choice !== undefined)
          violations.push({ kind: 'undecided_has_choice', entry, choice });
      }
      return verdictOf(violations);
    case 'resolved': {
      const entries = new Map(input.entries.map((e) => [e.id, e]));
      const stages = new Map(input.stages.map((s) => [s.id, s]));
      const policy = input.settings['break.double_qualifier'].value;
      const placedIn = new Map<Id, Id[]>();
      for (const { stage: stageId, bracket } of answer.stages) {
        const stage = stages.get(stageId);
        if (stage === undefined) {
          violations.push({ kind: 'break_stage_unknown', stage: stageId });
          continue;
        }
        for (const id of bracket.seeds) {
          const entry = entries.get(id);
          const eligible =
            entry !== undefined &&
            entry.breakEligible &&
            entry.status === 'active' &&
            (stage.division === null || entry.division === stage.division);
          if (!eligible)
            violations.push({
              kind: 'break_entry_ineligible',
              stage: stageId,
              entry: id,
            });
          placedIn.set(id, [...(placedIn.get(id) ?? []), stageId]);
          const choice = Object.hasOwn(input.choices, id)
            ? input.choices[id]
            : undefined;
          if (policy === 'choice' && choice !== undefined && choice !== stageId)
            violations.push({
              kind: 'break_against_choice',
              stage: stageId,
              entry: id,
              choice,
            });
        }
      }
      if (policy === 'higher')
        for (const [entry, at] of placedIn)
          if (at.length > 1)
            violations.push({ kind: 'break_entry_twice', entry, stages: at });
      return verdictOf(violations);
    }
  }
};
