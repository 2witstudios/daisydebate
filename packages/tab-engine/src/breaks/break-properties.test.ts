import { seededDraws } from '@daisy/seeded-random/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { BreakLine } from '../shapes/settings';
import { entry } from '../standings/build.test-support';
import { record, settingsWith, breakInput } from './build.test-support';
import { breaks } from './index';

setupRitewayBun();

describe('break properties', () => {
  test('under higher no entry is in two brackets', () => {
    const report = seededDraws({
      seed: 1,
      runs: 120,
      draws: 100,
      problems: (next) => {
        const ids = Array.from({ length: 4 + next(10) }, (_, i) => `e${i}`);
        const divisions = ['x', 'y'];
        const entries = ids.map((id) =>
          entry(id, {
            division: divisions[next(2)]!,
            breakEligible: next(5) > 0,
          }),
        );
        const played = ids.flatMap((id) =>
          record(id, next(4), next(3), 20 + next(10)),
        );
        const lines: BreakLine[] = [
          { kind: 'fixed', size: 1 + next(6) },
          { kind: 'record', wins: next(4) },
          {
            kind: 'record_capped',
            wins: next(4),
            cap: 1 + next(5),
            floor: next(5),
          },
          { kind: 'tie_inclusive', size: 1 + next(5), ceiling: 2 + next(6) },
        ];
        const stages = [
          { id: 'all', division: null },
          { id: 'x', division: 'x' },
          { id: 'y', division: 'y' },
        ];
        for (let i = stages.length - 1; i >= 1; i -= 1) {
          const j = next(i + 1);
          [stages[i], stages[j]] = [stages[j]!, stages[i]!];
        }
        const settings = settingsWith({
          'break.line': {
            default: lines[next(4)]!,
            byDivision: { x: lines[next(4)]! },
          },
          'break.double_qualifier': { value: 'higher' },
          'standings.tiebreaks': {
            metrics: ['wins'],
            minimumGames: null,
            terminal: 'lot',
          },
        });
        const answer = breaks(
          breakInput(entries, played, settings, stages.slice(0, 1 + next(3))),
        );
        const all =
          answer.kind === 'resolved'
            ? answer.stages.flatMap((st) => st.bracket.seeds)
            : ['undecided'];
        return new Set(all).size === all.length
          ? []
          : [`an entry in two brackets: ${all.join(' ')}`];
      },
    });
    assert({
      given: '120 seeded events with one to three stages and random lines',
      should: 'never put one entry in two brackets',
      actual: report.failure,
      expected: null,
    });
  });
});
