import { assert, setupRitewayBun, test } from 'riteway/bun';
import { nextPacing, noPacing, stageDue } from './round-pacing';

setupRitewayBun();

test('one Round’s pacing is one value with a pure transition (ISSUE-989)', () => {
  const failed = (times: number) => {
    let pacing = noPacing;
    for (let i = 0; i < times; i++)
      pacing = nextPacing(pacing, { on: 'stage_failed', stage: 'tick' }, 0);
    return pacing;
  };
  assert({
    given: 'repeated failures of one stage',
    should: 'double the wait up to its limit',
    actual: [1, 2, 5, 9].map((times) => failed(times).stages.tick?.retryAtMs),
    expected: [5_000, 10_000, 60_000, 60_000],
  });
  assert({
    given: 'a failed tick',
    should: 'back off only that stage',
    actual: [
      stageDue(failed(1), 'tick', 4_999),
      stageDue(failed(1), 'tick', 5_000),
      stageDue(failed(1), 'finalize', 0),
    ],
    expected: [false, true, true],
  });
  assert({
    given: 'that stage recovering',
    should: 'forget its failures',
    actual: nextPacing(failed(3), { on: 'stage_ok', stage: 'tick' }, 9),
    expected: noPacing,
  });
  const held = nextPacing(noPacing, { on: 'evaluated', found: 'held' }, 100);
  assert({
    given: 'a writer holding across evaluations',
    should: 'keep when the hold began, and back off the evaluation',
    actual: nextPacing(held, { on: 'evaluated', found: 'held' }, 900),
    expected: {
      heldSinceMs: 100,
      stages: { evaluate: { failures: 0, retryAtMs: 5_900 } },
    },
  });
  assert({
    given: 'the writer resolving and a decision landing',
    should: 'clear the hold and evaluate again at once',
    actual: nextPacing(held, { on: 'evaluated', found: 'decided' }, 900),
    expected: noPacing,
  });
  assert({
    given: 'an undecided window after an evaluation failure',
    should: 'clear the failure count and wait the plain retry',
    actual: nextPacing(
      nextPacing(noPacing, { on: 'stage_failed', stage: 'evaluate' }, 0),
      { on: 'evaluated', found: 'undecided' },
      50,
    ).stages.evaluate,
    expected: { failures: 0, retryAtMs: 5_050 },
  });
});
