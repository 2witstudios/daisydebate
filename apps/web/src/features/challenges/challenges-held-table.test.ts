import { assert, setupRitewayBun, test } from 'riteway/bun';
import { challengesHeld } from './challenges-held';
import {
  everyEvent,
  everyState,
  standingOf,
} from './challenges-held.test-support';

setupRitewayBun();

/** Where each event takes the offer; an event not listed changes nothing. */
const TRANSITIONS: Readonly<Record<string, Readonly<Record<string, string>>>> =
  {
    'not held': { 'listed standing': 'waiting' },
    waiting: {
      'listed gone': 'ended',
      'listed accepted': 'not held',
      cancelling: 'cancelling',
    },
    cancelling: {
      'listed gone': 'not held',
      'listed accepted': 'not held',
      'cancel-refused': 'waiting',
    },
    ended: { 'listed standing': 'waiting', dismissed: 'not held' },
  };

for (const [name, state] of everyState())
  test(`every event on an offer "${name}"`, () => {
    const cells: Record<string, string> = {};
    const kept: string[] = [];
    for (const [eventName, event] of everyEvent()) {
      const next = challengesHeld(state, event);
      const standing = standingOf(next, 'a');
      if (standing !== name) cells[eventName] = standing;
      // Only a read replaces what is held when the offer stays as it was.
      else if (next !== state && event.type !== 'listed') kept.push(eventName);
    }
    assert({
      given: `an offer "${name}" and every event`,
      should:
        'move as the table says, and return the same state for a command that does not apply',
      actual: { cells, kept },
      expected: { cells: TRANSITIONS[name], kept: [] },
    });
  });

test('the table covers every standing', () => {
  assert({
    given: 'the standings the table lists and those the tests can build',
    should: 'be the same standings',
    actual: Object.keys(TRANSITIONS).sort(),
    expected: everyState()
      .map(([name]) => name)
      .sort(),
  });
});

test('every built state holds the offer in the standing it is named for', () => {
  assert({
    given: 'each state the tests build',
    should: 'hold the offer in that standing',
    actual: everyState().map(([, state]) => standingOf(state, 'a')),
    expected: everyState().map(([name]) => name),
  });
});
