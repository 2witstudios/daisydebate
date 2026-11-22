import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  emptyPublicationSchedule,
  nextPublicationSchedule,
} from './publication-schedule';
setupRitewayBun();
describe('bot publication schedule', () => {
  test('lookahead waits for the current phrase schedule and authorizes each phrase once', () => {
    let state = emptyPublicationSchedule();
    state = nextPublicationSchedule(state, { type: 'starting' }).state;
    const waiting = nextPublicationSchedule(state, {
      type: 'prepare',
      phraseId: 'next',
      joined: false,
      nowMs: 100,
    });
    const scheduled = nextPublicationSchedule(waiting.state, {
      type: 'scheduled',
      endsAtMs: 900,
      nowMs: 200,
    });
    const duplicate = nextPublicationSchedule(scheduled.state, {
      type: 'prepare',
      phraseId: 'next',
      joined: true,
      nowMs: 300,
    });
    assert({
      given:
        'lookahead requested while the first join and schedule are pending',
      should: 'authorize only after the audio schedule is known',
      actual: {
        waiting: waiting.effects,
        ready: scheduled.effects,
        duplicate: duplicate.effects,
      },
      expected: {
        waiting: [],
        ready: [{ type: 'authorize', phraseId: 'next', startsInMs: 700 }],
        duplicate: [],
      },
    });
    const discarded = nextPublicationSchedule(scheduled.state, {
      type: 'discard',
    });
    const retry = nextPublicationSchedule(discarded.state, {
      type: 'prepare',
      phraseId: 'next',
      joined: true,
      nowMs: 300,
    });
    assert({
      given: 'lookahead discarded after a stopped phrase',
      should: 'allow fresh authorization on a later attempt',
      actual: retry.effects,
      expected: [{ type: 'authorize', phraseId: 'next', startsInMs: 600 }],
    });
  });
});
