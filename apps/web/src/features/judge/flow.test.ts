import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseWaitingStep, waitingView } from './flow';

setupRitewayBun();

describe('parseWaitingStep', () => {
  test('known, missing, repeated and unknown values', () => {
    assert({
      given: 'left, nothing, a repeated value and junk',
      should: 'read left as left and everything else as still waiting',
      actual: [
        parseWaitingStep({ step: 'left' }),
        parseWaitingStep({}),
        parseWaitingStep({ step: ['left', 'waiting'] }),
        parseWaitingStep({ step: 'offer' }),
        parseWaitingStep({ step: '\u0000' }),
      ],
      expected: ['left', 'waiting', 'left', 'waiting', 'waiting'],
    });
  });
});

describe('waitingView', () => {
  test('in the pool', () => {
    assert({
      given: '14 seconds in the pool with a two minute offer window',
      should: 'show both as readable times and link cancel to the left step',
      actual: waitingView('waiting', {
        waitedSeconds: 14,
        offerWindowSeconds: 120,
      }),
      expected: {
        step: 'waiting',
        waited: '0:14',
        offerWindow: '2 min',
        cancelHref: '/judge/waiting?step=left',
        restartHref: '/judge/waiting',
        hubHref: '/judge',
      },
    });
  });
});
