import { shuffleWith, wordStream } from '@daisy/seeded-random';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { BreakLine } from '../shapes/settings';
import { entry } from '../standings/build.test-support';
import { record, settingsWith, breakInput } from './build.test-support';
import { breaks } from './index';

setupRitewayBun();

describe('break properties', () => {
  test('under higher no entry is in two brackets', () => {
    const failures: number[] = [];
    for (let s = 0; s < 120; s += 1) {
      const stream = wordStream(
        'tab-engine-test/breaks',
        new Uint8Array([s]),
        new Uint8Array(),
      );
      let at = 0;
      const next = (below: number) => stream(at++) % below;
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
      const stages = shuffleWith(
        [
          { id: 'all', division: null },
          { id: 'x', division: 'x' },
          { id: 'y', division: 'y' },
        ],
        stream,
      ).slice(0, 1 + next(3));
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
      const answer = breaks(breakInput(entries, played, settings, stages));
      const all =
        answer.kind === 'resolved'
          ? answer.stages.flatMap((st) => st.bracket.seeds)
          : ['undecided'];
      if (new Set(all).size !== all.length) failures.push(s);
    }
    assert({
      given: '120 seeded events with one to three stages and random lines',
      should: 'never put one entry in two brackets',
      actual: failures,
      expected: [],
    });
  });
});
