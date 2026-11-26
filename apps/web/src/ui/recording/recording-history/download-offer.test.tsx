import { assert, setupRitewayBun, test } from 'riteway/bun';
import { accessibleWithin } from '../../../test-support/rendered/accessible';
import type * as Client from './download-offer.test-support';

setupRitewayBun();

test('reaching for a Premium download shows the panel in place and again after Not now', async () => {
  const { mountBrowserClient } =
    await import('../../test-support/browser-client.test-support');
  const client = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./download-offer.test-support', import.meta.dir),
    {
      URL,
      URLSearchParams,
      performance,
      process: { env: { NODE_ENV: 'test' } },
    },
  );
  try {
    await client.act(async () =>
      client.root.render(client.createElement(client.DownloadOffer)),
    );
    const shown = () =>
      accessibleWithin(client.container as unknown as Element);
    const panel = () =>
      shown().textContent().includes('Downloading is Premium');
    const download = () =>
      shown().get('button', 'Download video') as HTMLButtonElement;
    const before = panel();
    await client.act(async () => download().click());
    const after = panel();
    const href = shown().get('link', 'Get Premium').getAttribute('href');
    await client.act(async () =>
      (shown().get('button', 'Not now') as HTMLButtonElement).click(),
    );
    const dismissed = panel();
    await client.act(async () => download().click());
    assert({
      given: 'a free account pressing Download video',
      should:
        'show the Premium panel only after the press, hide it on Not now and show it on the next press',
      actual: { before, after, href, dismissed, again: panel() },
      expected: {
        before: false,
        after: true,
        href: '/premium',
        dismissed: false,
        again: true,
      },
    });
  } finally {
    await client.act(async () => client.root.unmount());
    await client.browser.happyDOM.close();
  }
});
