import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { recordResult, tallyRecord } from './debate-record';

setupRitewayBun();

const completed = (outcome: 'affirmative' | 'negative' | 'draw' | null) =>
  ({ status: 'completed', outcome }) as const;

describe('recordResult', () => {
  test('a ruled Round', () => {
    assert({
      given: 'a completed Round the affirmative won, from either debating side',
      should: 'be a win for the affirmative and a loss for the negative',
      actual: [
        recordResult(completed('affirmative'), 'affirmative'),
        recordResult(completed('affirmative'), 'negative'),
      ],
      expected: ['win', 'loss'],
    });
  });

  test('a forfeited Round', () => {
    assert({
      given:
        'a Round the negative forfeited, which completes with the affirmative outcome',
      should: 'be a win for the side that stayed and a loss for the forfeiter',
      actual: [
        recordResult(completed('affirmative'), 'affirmative'),
        recordResult(completed('affirmative'), 'negative'),
      ],
      expected: ['win', 'loss'],
    });
  });

  test('a split panel', () => {
    assert({
      given: 'a completed Round whose judges split evenly',
      should: 'be a draw for both sides',
      actual: [
        recordResult(completed('draw'), 'affirmative'),
        recordResult(completed('draw'), 'negative'),
      ],
      expected: ['draw', 'draw'],
    });
  });

  test('an unjudged Round', () => {
    assert({
      given: 'a completed Round with no outcome (no judges, or none ruled)',
      should: 'be no ruling, never a loss',
      actual: [
        recordResult(completed(null), 'affirmative'),
        recordResult(completed(null), 'negative'),
      ],
      expected: ['no-ruling', 'no-ruling'],
    });
  });

  test('Rounds outside the record', () => {
    assert({
      given:
        'an abandoned Round, a Round still scheduled or live, and a judge seat',
      should: 'not be part of the record at all',
      actual: [
        recordResult({ status: 'abandoned', outcome: null }, 'affirmative'),
        recordResult({ status: 'scheduled', outcome: null }, 'negative'),
        recordResult({ status: 'active', outcome: null }, 'affirmative'),
        recordResult(completed('affirmative'), 'judge'),
      ],
      expected: [null, null, null, null],
    });
  });
});

describe('tallyRecord', () => {
  test('counted results', () => {
    assert({
      given: 'grouped Rounds across sides, outcomes and states',
      should:
        'count wins, losses and draws, and leave out no-ruling, abandoned and judged-from-the-bench Rounds',
      actual: tallyRecord([
        { ...completed('affirmative'), role: 'affirmative', rounds: 3 },
        { ...completed('negative'), role: 'affirmative', rounds: 2 },
        { ...completed('negative'), role: 'negative', rounds: 1 },
        { ...completed('draw'), role: 'negative', rounds: 1 },
        { ...completed(null), role: 'affirmative', rounds: 4 },
        { status: 'abandoned', outcome: null, role: 'negative', rounds: 5 },
        { ...completed('affirmative'), role: 'judge', rounds: 6 },
      ]),
      expected: { wins: 4, losses: 2, draws: 1 },
    });
  });

  test('no Rounds', () => {
    assert({
      given: 'a member with no Rounds',
      should: 'be an empty record',
      actual: tallyRecord([]),
      expected: { wins: 0, losses: 0, draws: 0 },
    });
  });
});
