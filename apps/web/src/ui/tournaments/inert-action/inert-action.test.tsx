import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { DisabledAction, InertAction } from './inert-action';

setupRitewayBun();

describe('InertAction', () => {
  test('disabled and labelled', () => {
    const html = renderToString(h(InertAction, { id: 'calendar' }));
    assert({
      given: 'the calendar action',
      should: 'be a disabled button with its label that never submits',
      actual: [
        html.includes('disabled=""'),
        html.includes('type="button"'),
        html.includes('>Add to calendar</button>'),
      ],
      expected: [true, true, true],
    });
  });
});

describe('DisabledAction', () => {
  test('any label, disabled', () => {
    const html = renderToString(
      h(DisabledAction, { label: 'Check in (opens 13:50)' }),
    );
    assert({
      given: 'a one-off disabled action',
      should: 'be disabled and show its label',
      actual: [
        html.includes('disabled=""'),
        html.includes('Check in (opens 13:50)'),
      ],
      expected: [true, true],
    });
  });
});
