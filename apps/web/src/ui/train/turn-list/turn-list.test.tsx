import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { TurnRow } from '../../../features/train/live';
import { TurnList } from './turn-list';

setupRitewayBun();

const rows: TurnRow[] = [
  {
    seq: 1,
    name: 'Turn 1: Aff speech',
    who: 'You',
    length: '5:00',
    state: 'done',
  },
  {
    seq: 2,
    name: 'Turn 2: Neg speech',
    who: 'AI debater',
    length: '5:00',
    state: 'failed',
  },
  {
    seq: 3,
    name: 'Turn 3: Aff speech',
    who: 'You',
    length: '5:00',
    state: 'todo',
  },
];

describe('TurnList', () => {
  test('every turn in order with its state in words for readers', () => {
    const html = renderToString(
      h(TurnList, {
        rows,
        footer: { label: 'Prep time left', value: '4:00 of 4:00' },
      }),
    );
    assert({
      given: 'a done, a failed and a to-come turn',
      should: 'list them in an ordered list with state words and the footer',
      actual: [
        html.includes('<ol'),
        html.match(/<li/g)?.length,
        html.includes(', done'),
        html.includes(', opponent unavailable'),
        html.includes(', to come'),
        html.includes('Prep time left'),
      ],
      expected: [true, 3, true, true, true, true],
    });
  });
});
