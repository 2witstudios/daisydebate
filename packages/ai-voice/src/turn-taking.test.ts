import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTurnTaking, turnTakingSettings } from './turn-taking';

setupRitewayBun();

type Machine = ReturnType<typeof createTurnTaking>;
/** Feeds one 10 ms frame per step from `from` to `to` and collects the events. */
const run = (
  machine: Machine,
  from: number,
  to: number,
  level: (at: number) => number | null,
  aiPlaying = false,
) => {
  const events: string[] = [];
  for (let at = from; at < to; at += 10) {
    const event = machine.feed({ at, level: level(at), aiPlaying });
    if (event)
      events.push(
        event.kind === 'end-of-turn'
          ? `end-of-turn@${at} spoke-until ${event.spokeUntil}`
          : `${event.kind}@${at}`,
      );
  }
  return events;
};
const steady = (level: number) => () => level;
/** Speech as a microphone hears it: 120 ms syllables, each with a 50 ms dip to near silence. */
const syllables = (peak: number) => (at: number) =>
  at % 120 < 70 ? peak : 0.004;

describe('createTurnTaking', () => {
  test('a peer speaks, pauses and their turn ends', () => {
    const machine = createTurnTaking(turnTakingSettings);
    assert({
      given: 'silence',
      should: 'report nothing',
      actual: run(machine, 0, 500, steady(0.002)),
      expected: [],
    });
    assert({
      given: 'speech with syllable dips',
      should: 'report speech starting once, after the minimum speech time',
      actual: run(machine, 500, 2000, (at) => syllables(0.08)(at - 500)),
      expected: ['speech-start@650'],
    });
    assert({
      given: 'a 400 ms breath, then more speech',
      should: 'not end the turn',
      actual: [
        ...run(machine, 2000, 2400, steady(0.002)),
        ...run(machine, 2400, 3000, (at) => syllables(0.08)(at - 2400)),
      ],
      expected: [],
    });
    assert({
      given: 'silence longer than the end-of-turn pause',
      should:
        'report the end of the turn once, naming the instant the peer last spoke',
      actual: run(machine, 3000, 4500, steady(0.002)),
      expected: ['end-of-turn@3930 spoke-until 2940'],
    });
  });

  test('talking over the bot is a barge-in within 300 ms', () => {
    const machine = createTurnTaking(turnTakingSettings);
    assert({
      given: "a trace of the bot's own voice in the microphone",
      should: 'not count as a barge-in',
      actual: run(machine, 0, 1000, steady(0.02), true),
      expected: [],
    });
    assert({
      given: 'speech with syllable dips while the bot plays',
      should: 'report one barge-in within 300 ms',
      actual: run(machine, 1000, 1600, (at) => syllables(0.1)(at - 1000), true),
      expected: ['barge-in@1200'],
    });
    assert({
      given: 'the peer mid-turn after a barge-in',
      should: 'be speaking, then end the turn after a pause',
      actual: [
        machine.speaking(),
        run(machine, 1600, 3000, steady(0.002)).length,
        machine.speaking(),
      ],
      expected: [true, 1, false],
    });
  });

  test('a single loud frame is not a barge-in', () => {
    const machine = createTurnTaking(turnTakingSettings);
    assert({
      given: 'one click while the bot plays',
      should: 'report nothing',
      actual: run(machine, 0, 600, (at) => (at === 100 ? 0.5 : 0.002), true),
      expected: [],
    });
  });

  test('unheard audio keeps a turn and never starts one', () => {
    const idle = createTurnTaking(turnTakingSettings);
    assert({
      given: 'no fresh audio and no turn in progress',
      should: 'report nothing, however long',
      actual: run(idle, 0, 3000, steady(null as never)),
      expected: [],
    });
    const machine = createTurnTaking(turnTakingSettings);
    run(machine, 0, 1000, syllables(0.08));
    assert({
      given: 'a 300 ms gap in the audio mid-turn, then speech again',
      should: 'keep the turn in progress and report no second start',
      actual: [
        ...run(machine, 1000, 1300, () => null),
        ...run(machine, 1300, 1800, (at) => syllables(0.08)(at - 1300)),
        String(machine.speaking()),
      ],
      expected: ['true'],
    });
    assert({
      given: 'a peer unheard for the end-of-turn pause, mid-turn',
      should: 'end the turn',
      actual: run(machine, 1800, 3000, () => null).map(
        (event) => event.split('@')[0],
      ),
      expected: ['end-of-turn'],
    });
  });
});

test('sound under the barge-in level while the bot plays does not move when the peer last spoke', () => {
  const machine = createTurnTaking(turnTakingSettings);
  run(machine, 0, 1000, steady(0.08));
  // The bot starts over the peer's pause: its echo sits between the levels.
  run(machine, 1000, 2000, steady(0.02), true);
  assert({
    given:
      'a peer who stopped at 990 ms, then a second of faint echo while the bot plays, then silence',
    should: 'end the turn naming 990 ms, not the echo',
    actual: run(machine, 2000, 3200, steady(0.002)).map(
      (event) => event.split(' spoke-until ')[1],
    ),
    expected: ['990'],
  });
});
