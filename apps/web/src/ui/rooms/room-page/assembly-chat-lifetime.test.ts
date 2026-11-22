import { test, expect } from 'bun:test';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import type * as Client from './assembly-chat-lifetime.test-support';

test('initial device readiness preserves the pending Room chat admission', async () => {
  const client = await mountBrowserClient<typeof Client>(
    `${import.meta.dir}/assembly-chat-lifetime.test-support.tsx`,
    { URLSearchParams, URL, TextEncoder, TextDecoder, process: { env: {} } },
  );
  try {
    await client.act(async () => {
      client.root.render(client.createElement(client.AssemblyWithPendingChat));
    });
    await client.act(async () => {
      client.finishFirstDiscovery();
    });
    expect({
      reads: client.discoveryCount(),
      text: client.container.querySelector('output')?.textContent,
    }).toEqual({ reads: 1, text: 'Recovered Room chat' });
  } finally {
    await client.act(async () => client.root.unmount());
    await client.browser.happyDOM.close();
  }
});
