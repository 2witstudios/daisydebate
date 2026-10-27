import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { DisabledAction, InertAction } from './inert-action';

setupRitewayBun();

describe('InertAction', () => {
  test('a working link, labelled by the registry', () => {
    const html = renderToString(h(InertAction, { id: 'calendar' }));
    assert({
      given: 'the calendar action',
      should: 'be a link that answers on the same page, not a disabled button',
      actual: [
        html.includes('href="?did=Add+to+calendar"'),
        html.includes('Add to calendar'),
        html.includes('disabled=""'),
        html.includes('<button'),
      ],
      expected: [true, true, false, false],
    });
  });
});

describe('DisabledAction', () => {
  test('a control that is unavailable right now', () => {
    const html = renderToString(
      h(DisabledAction, {
        label: 'Check in (opens 13:50)',
        reason: 'Too early.',
      }),
    );
    assert({
      given: 'a control the screen can say is unavailable',
      should: 'stay disabled and name its reason',
      actual: [
        html.includes('disabled=""'),
        html.includes('Check in (opens 13:50) (Too early.)'),
      ],
      expected: [true, true],
    });
  });
});
