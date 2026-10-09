import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';
import { initialMockForm } from '../../../features/mock-form/form';

setupRitewayBun();
await mockNextRouter();
const { CreateRoomPage } = await import('./create-room-page');

test('create page renders durable-create fields without a placeholder judge', () => {
  const html = renderToString(
    h(CreateRoomPage, {
      action: async () => initialMockForm,
      choices: [],
      commandId: 'n'.repeat(24),
    }),
  );
  assert({
    given: 'a catalog-backed create screen whose catalog is empty',
    should:
      'show one heading, a native form with title/topic/visibility/dedupe fields and refuse submission until templates exist',
    actual: [
      (html.match(/<h1 /g) ?? []).length,
      html.includes('<form'),
      ['title', 'topic', 'selection', 'visibility', 'commandId'].every((name) =>
        html.includes(`name="${name}"`),
      ),
      html.includes('No format templates are available yet.'),
      html.includes('disabled=""'),
      html.includes('Placeholder AI judge'),
      html.includes('href="/lobby"'),
    ],
    expected: [1, true, true, true, true, false, true],
  });
});
