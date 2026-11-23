import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRefreshSettlement } from './refresh-settlement';

setupRitewayBun();

const settlement = () => {
  const log: string[] = [];
  let fire: (() => void) | null = null;
  const refresh = createRefreshSettlement({
    wait: (run, ms) => {
      log.push(`wait ${ms}`);
      fire = run;
      return () => {
        log.push('cancel');
        fire = null;
      };
    },
    limitMs: 30_000,
    settled: () => log.push('settled'),
  });
  return { refresh, log, elapse: () => fire?.() };
};

test('a read settles the refresh only once no refresh transition runs', () => {
  const { refresh, log } = settlement();
  refresh.asked();
  refresh.transitionRan(true);
  refresh.readFinished();
  const whileRunning = [...log];
  refresh.transitionRan(false);
  assert({
    given: 'a read that finishes while the refresh transition is still running',
    should: 'wait for the transition to end, then settle once',
    actual: [whileRunning, log],
    expected: [['wait 30000'], ['wait 30000', 'cancel', 'settled']],
  });
});

test('an ended transition alone, or a read before any refresh, settles nothing', () => {
  const { refresh, log } = settlement();
  refresh.readFinished();
  refresh.asked();
  refresh.transitionRan(true);
  refresh.transitionRan(false);
  const afterDiscard = [...log];
  refresh.readFinished();
  assert({
    given:
      'a read with no refresh, then a discarded transition, then the held read',
    should: 'settle only when the held read arrives',
    actual: [afterDiscard, log],
    expected: [['wait 30000'], ['wait 30000', 'cancel', 'settled']],
  });
});

test('a refresh whose read is never recorded settles at its bound, once', () => {
  const { refresh, log, elapse } = settlement();
  refresh.asked();
  elapse();
  refresh.readFinished();
  refresh.dispose();
  assert({
    given: 'a refresh with no read, its bound elapsing, then a late read',
    should: 'settle once at the bound and ignore the late read',
    actual: log,
    expected: ['wait 30000', 'cancel', 'settled'],
  });
});
