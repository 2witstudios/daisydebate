import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTurnTaking, defaultTurnTakingSettings } from './turn-taking';

setupRitewayBun();

/** Feeds `level` every 50 ms from `from` to `to` and collects the events. */
const run = (
  machine: ReturnType<typeof createTurnTaking>,
  from: number,
  to: number,
  level: number,
  aiPlaying = false,
) => {
  const events: string[] = [];
  for (let t = from; t < to; t += 50) {
    const event = machine.feed({ at: t, level, aiPlaying });
    if (event) events.push(`${event}@${t}`);
  }
  return events;
};

describe('createTurnTaking', () => {
  test('a person speaks, pauses and their turn ends', () => {
    const machine = createTurnTaking(defaultTurnTakingSettings);
    const quiet = run(machine, 0, 500, 0.002);
    const speaking = run(machine, 500, 2000, 0.08);
    const pause = run(machine, 2000, 3200, 0.002);
    assert({
      given: 'silence',
      should: 'report nothing',
      actual: quiet,
      expected: [],
    });
    assert({
      given: 'sustained speech above the threshold',
      should: 'report speech starting once, after the minimum speech time',
      actual: speaking,
      expected: ['speech-start@650'],
    });
    assert({
      given: 'silence after speech longer than the end-of-turn pause',
      should: 'report the end of the turn once',
      actual: pause,
      expected: ['end-of-turn@2900'],
    });
  });

  test('a short breath mid-sentence does not end the turn', () => {
    const machine = createTurnTaking(defaultTurnTakingSettings);
    run(machine, 0, 1000, 0.08);
    const breath = run(machine, 1000, 1400, 0.002);
    const more = run(machine, 1400, 2000, 0.08);
    assert({
      given: 'a 400 ms pause between phrases',
      should: 'not end the turn',
      actual: [...breath, ...more],
      expected: [],
    });
  });

  test('barge-in while the AI is talking needs louder, sustained speech', () => {
    const machine = createTurnTaking(defaultTurnTakingSettings);
    const echo = run(machine, 0, 1000, 0.05, true);
    const interrupt = run(machine, 1000, 1600, 0.2, true);
    assert({
      given:
        "the AI's own voice leaking into the microphone at a moderate level",
      should: 'not count as a barge-in',
      actual: echo,
      expected: [],
    });
    assert({
      given: 'loud sustained speech while the AI plays',
      should: 'report a barge-in',
      actual: interrupt,
      expected: ['barge-in@1300'],
    });
  });
});
