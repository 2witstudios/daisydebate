import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { figureClass, statusTone } from './rating-display-class';

setupRitewayBun();

describe('figureClass', () => {
  test('numbers are display-sized, unrated is muted', () => {
    assert({
      given: 'each rating kind',
      should: 'size a number big and mute the word Unrated',
      actual: [
        figureClass('provisional'),
        figureClass('established'),
        figureClass('unrated'),
      ],
      expected: [
        'font-display text-display-sm leading-none font-bold',
        'font-display text-display-sm leading-none font-bold',
        'font-display text-3xl leading-none font-bold text-ink-faint',
      ],
    });
  });
});

describe('statusTone', () => {
  test('one tone per kind', () => {
    assert({
      given: 'each rating kind',
      should: 'pick gold, accent and neutral',
      actual: [
        statusTone('provisional'),
        statusTone('established'),
        statusTone('unrated'),
      ],
      expected: ['gold', 'accent', 'neutral'],
    });
  });
});
