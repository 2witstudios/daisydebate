import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { DisabledAction, InertAction } from './inert-action';

setupRitewayBun();

describe('InertAction', () => {
  test('disabled, labelled, with its reason', () => {
    const html = renderToString(h(InertAction, { id: 'calendar' }));
    assert({
      given: 'the calendar action',
      should: 'be a disabled button that names its reason and never submits',
      actual: [
        html.includes('disabled=""'),
        html.includes('type="button"'),
        html.includes(
          'Add to calendar (Calendar files are not available yet.)',
        ),
      ],
      expected: [true, true, true],
    });
  });
});

describe('DisabledAction', () => {
  test('any label and reason, disabled', () => {
    const html = renderToString(
      h(DisabledAction, {
        label: 'Check in (opens 13:50)',
        reason: 'Too early.',
      }),
    );
    assert({
      given: 'a one-off disabled action',
      should: 'be disabled and name its reason',
      actual: [
        html.includes('disabled=""'),
        html.includes('Check in (opens 13:50) (Too early.)'),
      ],
      expected: [true, true],
    });
  });
});
