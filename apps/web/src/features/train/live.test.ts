import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mockOpponent } from '../../ui/mock/train-practice';
import { liveView, type SpeechView } from './live';
import { defaultConfig } from './practice';

setupRitewayBun();

const speech = (view: ReturnType<typeof liveView>): SpeechView => {
  if (view?.kind !== 'speech') throw new Error('expected a speech');
  return view;
};

describe('liveView', () => {
  test('your turn', () => {
    const view = speech(liveView(defaultConfig, 'aff', 1, mockOpponent));
    assert({
      given: 'the first turn as Aff against the AI',
      should: 'be yours, turn 1 of 5, with prompts, a hint and the next turn',
      actual: [
        view.turn.name,
        view.yours,
        `${view.number} of ${view.total}`,
        view.verb,
        view.prompts?.length,
        view.hint !== null,
        view.nextSeq,
        view.youAre,
        view.prepLabel,
        view.rows.map((row) => row.state),
      ],
      expected: [
        'Turn 1: Aff speech',
        true,
        '1 of 5',
        'You are speaking',
        3,
        true,
        2,
        'You are Aff',
        '4:00 of 4:00',
        ['current', 'todo', 'todo', 'todo', 'todo'],
      ],
    });
  });

  test('the opponent speaks through the adapter', () => {
    const view = speech(liveView(defaultConfig, 'aff', 2, mockOpponent));
    assert({
      given: 'turn 2, the AI debater',
      should: 'listen, with the opponent words, earlier turns done',
      actual: [
        view.yours,
        view.verb,
        view.text.startsWith('The motion assumes'),
        view.rows.map((row) => row.state),
        view.opponentNote,
      ],
      expected: [
        false,
        'The AI debater is speaking',
        true,
        ['done', 'current', 'todo', 'todo', 'todo'],
        'Sandbox actor. Practice only.',
      ],
    });
  });

  test('the last turn has no next', () => {
    assert({
      given: 'turn 5',
      should: 'have no next turn',
      actual: speech(liveView(defaultConfig, 'aff', 5, mockOpponent)).nextSeq,
      expected: null,
    });
  });

  test('coaching off hides prompts and hints', () => {
    const view = speech(
      liveView(
        { ...defaultConfig, coach: false, hints: false },
        'aff',
        1,
        mockOpponent,
      ),
    );
    assert({
      given: 'coach prompts and hints off',
      should: 'offer neither',
      actual: [view.prompts, view.hint],
      expected: [null, null],
    });
  });

  test('prep of zero minutes', () => {
    const view = speech(
      liveView(
        { ...defaultConfig, rules: { ...defaultConfig.rules, prepMinutes: 0 } },
        'aff',
        1,
        mockOpponent,
      ),
    );
    assert({
      given: 'no prep time',
      should: 'say so',
      actual: view.prepLabel,
      expected: 'No prep time',
    });
  });

  test('an unavailable opponent stops the practice on its turn', () => {
    const view = liveView(defaultConfig, 'aff', 2, () => ({ ok: false }));
    assert({
      given: 'an adapter that does not answer turn 2',
      should: 'report unavailable with that turn marked failed',
      actual:
        view?.kind === 'unavailable'
          ? [view.turn.seq, view.rows.map((row) => row.state)]
          : null,
      expected: [2, ['done', 'failed', 'todo', 'todo', 'todo']],
    });
  });

  test('your own turn never asks the adapter', () => {
    let asked = 0;
    liveView(defaultConfig, 'aff', 1, () => {
      asked += 1;
      return { ok: false };
    });
    assert({
      given: 'turn 1, which is yours',
      should: 'not call the opponent',
      actual: asked,
      expected: 0,
    });
  });

  test('solo uses only your seat', () => {
    const view = speech(
      liveView({ ...defaultConfig, opponent: 'solo' }, 'aff', 1, mockOpponent),
    );
    assert({
      given: 'solo speeches',
      should: 'run three turns with the solo note',
      actual: [view.total, view.opponentNote],
      expected: [3, 'No opponent. Only your seat speaks.'],
    });
  });
});
