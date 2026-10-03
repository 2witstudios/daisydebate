import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { initialMockForm } from '../../../features/mock-form/form';

setupRitewayBun();

// The form reads the Next router, which only exists in a running app.
await mockNextRouter();
const { CreateRoomPage } = await import('./create-room-page');

const html = renderToString(
  h(CreateRoomPage, { action: async () => initialMockForm }),
);

describe('CreateRoomPage', () => {
  test('the settings', () => {
    assert({
      given: 'the create-room page',
      should:
        'offer a name, a format, speech and prep lengths and the two judge choices, with a person chosen',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('name="name"'),
        html.includes('name="format"'),
        html.includes('name="speech"'),
        html.includes('name="prep"'),
        (html.match(/type="radio"/g) ?? []).length,
        /value="person"[^>]*checked=""|checked=""[^>]*value="person"/.test(
          html,
        ),
      ],
      expected: [1, true, true, true, true, 2, true],
    });
  });

  test('a real POST, with no visibility or rules to choose', () => {
    assert({
      given: 'the create-room page',
      should:
        'be a form with a submit, say practice is unranked, and offer no visibility choice',
      actual: [
        html.includes('<form'),
        html.includes('Open room'),
        html.includes('Practice is unranked'),
        html.includes('Visibility'),
        html.includes('href="/ranked/host"'),
      ],
      expected: [true, true, true, false, true],
    });
  });

  test('the judge is always there', () => {
    assert({
      given: 'the create-room page',
      should: 'say every room has a judge and label the AI judge a placeholder',
      actual: [
        html.includes('Every room has a judge'),
        html.includes('Placeholder AI judge'),
      ],
      expected: [true, true],
    });
  });
});
