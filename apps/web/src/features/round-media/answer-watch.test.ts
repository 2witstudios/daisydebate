import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAnswerWatch, type MediaAnswer } from './answer-watch';

setupRitewayBun();

const watched = () => {
  const answers: MediaAnswer[] = [];
  const timers: { ms: number; fire: () => void; cancelled: boolean }[] = [];
  const watch = createAnswerWatch({
    budgetMs: 40_000,
    at: (ms, fire) => {
      const timer = { ms, fire, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    changed: (answer) => answers.push(answer),
  });
  return { answers, timers, watch };
};

test('an answer that never comes turns stale at the budget', () => {
  const { answers, timers, watch } = watched();
  watch.superseded();
  watch.superseded();
  timers[0]!.fire();
  assert({
    given: 'two supersessions and no answer until the budget passes',
    should: 'check once, start one budget from the first, then turn stale',
    actual: [answers, timers.map((timer) => timer.ms)],
    expected: [['checking', 'stale'], [40_000]],
  });
});

test('an answer ends the check and its budget', () => {
  const { answers, timers, watch } = watched();
  watch.superseded();
  watch.received();
  watch.superseded();
  assert({
    given: 'an answer between two supersessions',
    should: 'cancel the first budget, be current, and start a fresh one',
    actual: [answers, timers.map((timer) => timer.cancelled)],
    expected: [
      ['checking', 'current', 'checking'],
      [true, false],
    ],
  });
});

test('an answer after going stale makes it current again', () => {
  const { answers, timers, watch } = watched();
  watch.superseded();
  timers[0]!.fire();
  watch.received();
  assert({
    given: 'a late answer after the budget passed',
    should: 'name the answer as current again',
    actual: answers,
    expected: ['checking', 'stale', 'current'],
  });
});

test('stopping cancels the budget', () => {
  const { timers, watch } = watched();
  watch.superseded();
  watch.stop();
  assert({
    given: 'a mount ending while checking',
    should: 'leave no budget running',
    actual: timers[0]!.cancelled,
    expected: true,
  });
});
