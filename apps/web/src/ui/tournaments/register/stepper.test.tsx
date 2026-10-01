import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Stepper } from './stepper';

setupRitewayBun();

describe('Stepper', () => {
  test('marks done, current and todo steps', () => {
    const html = renderToString(
      h(Stepper, {
        label: 'Registration steps',
        steps: [
          { label: 'Eligibility', state: 'done' },
          { label: 'Entry', state: 'current' },
          { label: 'Review', state: 'todo' },
        ],
      }),
    );
    assert({
      given: 'a done, a current and a todo step',
      should:
        'label the list, show a tick, mark one current step and a number for todo',
      actual: [
        html.includes('aria-label="Registration steps"'),
        html.includes('✓'),
        html.match(/aria-current="step"/g)?.length,
        html.includes('Eligibility</span><span class="sr-only">, done'),
        html.includes('>3<'),
      ],
      expected: [true, true, 1, true, true],
    });
  });
});
