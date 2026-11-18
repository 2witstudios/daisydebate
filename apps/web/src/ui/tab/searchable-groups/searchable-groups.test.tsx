import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from './searchable-groups.test-support';
setupRitewayBun();
test('a query finds a hidden row and a status narrows it without losing the query', async () => {
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./searchable-groups.test-support', import.meta.dir),
    {
      process: { env: { NODE_ENV: 'test' } },
      performance,
      URL,
      URLSearchParams,
    },
  );
  try {
    await client.act(async () =>
      client.root.render(
        client.createElement(client.SearchableGroups, {
          label: 'Find a room',
          statuses: [
            { id: 'live', label: 'Live' },
            { id: 'judging', label: 'Judging' },
          ],
          groups: [
            {
              heading: 'Rooms',
              limit: 1,
              rows: [
                {
                  title: 'A v B',
                  detail: 'Room 1 · Shah',
                  status: 'live',
                  action: null,
                },
                {
                  title: 'C v D',
                  detail: 'Room 2 · Reyes',
                  status: 'judging',
                  action: null,
                },
                {
                  title: 'E v F',
                  detail: 'Room 3 · Reyes',
                  status: 'live',
                  action: null,
                },
              ],
            },
          ],
        }),
      ),
    );
    const input = client.container.querySelector('input')!;
    await client.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        client.browser.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'Reyes');
      input.dispatchEvent(new client.browser.Event('input', { bubbles: true }));
    });
    const queried = [...client.container.querySelectorAll('li')].map(
      (row) => row.textContent,
    );
    await client.act(async () =>
      [...client.container.querySelectorAll('button')]
        .find((button) => button.textContent?.startsWith('Live'))!
        .click(),
    );
    assert({
      given:
        'a hidden judging room and a live room both judged by Reyes, then Live selected',
      should:
        'find both before narrowing to the live room while retaining Reyes',
      actual: [
        queried.some((text) => text?.includes('C v D')),
        queried.some((text) => text?.includes('E v F')),
        client.container.textContent?.includes('C v D'),
        client.container.textContent?.includes('E v F'),
        input.value,
      ],
      expected: [true, true, false, true, 'Reyes'],
    });
  } finally {
    await client.act(async () => client.root.unmount());
  }
});
