import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { initialFormState } from '../../../features/forms/form-state';

setupRitewayBun();
await mockNextRouter();
const { CreateRoomPage } = await import('./create-room-page');

test('create page renders durable-create fields without a placeholder judge', () => {
  const html = renderToString(
    h(CreateRoomPage, {
      initialState: initialFormState,
      choices: [],
      commandId: 'n'.repeat(24),
    }),
  );
  assert({
    given: 'a catalog-backed create screen whose catalog is empty',
    should:
      'show one heading and a native form that refuses creation until formats exist',
    actual: [
      (html.match(/<h1 /g) ?? []).length,
      html.includes('<form'),
      ['title'].every((name) => html.includes(`name="${name}"`)),
      html.includes('No formats are available yet.'),
      html.includes('disabled=""'),
      html.includes('Placeholder AI judge'),
      html.includes('href="/lobby"'),
    ],
    expected: [1, true, true, true, true, false, true],
  });
});
