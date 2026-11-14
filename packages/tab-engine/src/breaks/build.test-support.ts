import type { Entry, Id, TwoSides } from '../shapes/competition';
import type { BreaksAnswer, BreaksInput, BreakStage } from '../shapes/folds';
import type { ResolvedSettings } from '../shapes/settings';
import {
  type Played,
  debate,
  historyOf,
  seed,
  twoSides,
  withTiebreaks,
} from '../standings/build.test-support';

/** `wins` wins then `losses` losses against outsiders, `points` a game. */
export const record = (
  id: Id,
  wins: number,
  losses: number,
  points = 27,
): Played<TwoSides>[] =>
  Array.from({ length: wins + losses }, (_, k) => {
    const other = `${id}-opp${k}`;
    return k < wins
      ? debate(`${id}-g${k}`, k + 1, [id, other], id, [points, 25])
      : debate(`${id}-g${k}`, k + 1, [id, other], other, [points, 25]);
  });

export const settingsWith = (
  over: Partial<ResolvedSettings>,
): ResolvedSettings => ({
  ...withTiebreaks(['wins', 'total_points']),
  ...over,
});

export const breakInput = (
  entries: readonly Entry[],
  played: readonly Played<TwoSides>[],
  settings: ResolvedSettings,
  stages: readonly BreakStage[],
  over: Partial<Pick<BreaksInput, 'ratings' | 'cutoff' | 'choices'>> = {},
): BreaksInput => ({
  format: twoSides,
  entries,
  history: historyOf(played),
  settings,
  cutoff: 99,
  ratings: null,
  seed,
  stages,
  choices: {},
  ...over,
});

export const seedsOf = (answer: BreaksAnswer) =>
  answer.kind === 'resolved'
    ? answer.stages.map((s) => `${s.stage}: ${s.bracket.seeds.join(' ')}`)
    : answer;
