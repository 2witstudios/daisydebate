import type { Page, Route } from '@playwright/test';
import { expect } from './fixtures';
import { origin } from './accounts';
import { createId } from '@paralleldrive/cuid2';
const floor = (page: Page) =>
  page.getByRole('region', { name: 'Round floor chat', exact: true });
const input = (page: Page) =>
  floor(page).getByRole('textbox', {
    name: 'Message debaters and host',
    exact: true,
  });
const history = (page: Page) =>
  floor(page).getByRole('list', { name: 'Floor messages' });
/** Lose only the real action response, after its canonical durable write has completed. */
export async function proveFloorResilience({
  host,
  peer,
  roundId,
  channelId,
}: {
  readonly host: Page;
  readonly peer: Page;
  readonly roundId: string;
  readonly channelId: string;
}) {
  const read = async () => {
    const response = await host.request.get(
      `/api/rounds/${roundId}/floor/messages?channelId=${channelId}`,
    );
    expect(response.status()).toBe(200);
    return response.json();
  };
  const text = 'A committed floor send with a lost answer';
  const requestId = await floor(peer)
    .locator('form')
    .last()
    .locator('input[name="requestId"]')
    .inputValue();
  let lost = false;
  const intercept = async (route: Route) => {
    if (
      !lost &&
      route.request().method() === 'POST' &&
      route.request().headers()['next-action']
    ) {
      lost = true;
      const result = await route.fetch();
      expect(result.status()).toBe(200);
      await route.abort('internetdisconnected');
    } else await route.continue();
  };
  await peer.route(`**/rounds/${roundId}/room`, intercept);
  try {
    await input(peer).fill(text);
    await floor(peer)
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect(
      floor(peer).getByRole('button', { name: 'Retry message', exact: true }),
    ).toBeEnabled();
    await expect(input(peer)).toHaveValue(text);
    await expect(input(peer)).not.toBeEditable();
    expect(
      await floor(peer)
        .locator('form')
        .last()
        .locator('input[name="requestId"]')
        .inputValue(),
    ).toBe(requestId);
    const before = (await read()).history.messages.filter(
      (m: { text?: string }) => m.text === text,
    );
    expect(before).toHaveLength(1);
    await peer.unroute(`**/rounds/${roundId}/room`, intercept);
    await floor(peer)
      .getByRole('button', { name: 'Retry message', exact: true })
      .click();
    await expect(input(peer)).toHaveValue('');
    const after = (await read()).history.messages.filter(
      (m: { text?: string }) => m.text === text,
    );
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
  } finally {
    await peer.unroute(`**/rounds/${roundId}/room`, intercept);
  }
  // Native offline transport makes the short observation permit expire. No seeded
  // history may remain visible; reconnect must perform an authorized fresh read.
  await peer.context().setOffline(true);
  try {
    await expect(history(peer)).toBeHidden({ timeout: 15_000 });
    const response = await host.request.post(
      `/api/rounds/${roundId}/floor/messages`,
      {
        headers: { origin },
        data: {
          version: 1,
          channelId,
          requestId: createId(),
          text: 'Arrived while peer was offline',
        },
      },
    );
    expect(response.status()).toBe(200);
  } finally {
    await peer.context().setOffline(false);
  }
  const retry = floor(peer).getByRole('button', {
    name: 'Try again',
    exact: true,
  });
  if (await retry.isVisible()) await retry.click();
  await expect(
    history(peer).getByText('Arrived while peer was offline', { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  // The mounted panel on a phone must not mark new messages read while Doc is selected.
  const viewport = peer.viewportSize();
  await peer.setViewportSize({ width: 390, height: 844 });
  try {
    const tabs = peer.getByRole('navigation', { name: 'Round', exact: true });
    await tabs.getByRole('button', { name: 'Doc', exact: true }).click();
    const prior = await peer.request.get(
      `/api/rounds/${roundId}/floor/messages?channelId=${channelId}`,
    );
    const readBefore = (await prior.json()).history.viewer.readSequence;
    const sent = await host.request.post(
      `/api/rounds/${roundId}/floor/messages`,
      {
        headers: { origin },
        data: {
          version: 1,
          channelId,
          requestId: createId(),
          text: 'Unread on the phone Doc tab',
        },
      },
    );
    expect(sent.status()).toBe(200);
    const newest = await sent.json();
    expect(newest.sequence).toBeGreaterThan(readBefore);
    await expect(
      tabs.getByRole('button', { name: /^Channels, [1-9][0-9]* unread$/ }),
    ).toBeVisible();
    const unread = await peer.request.get(
      `/api/rounds/${roundId}/floor/messages?channelId=${channelId}`,
    );
    expect((await unread.json()).history.viewer.readSequence).toBe(readBefore);
    await tabs.getByRole('button', { name: /^Channels/ }).click();
    await expect(
      history(peer).getByText('Unread on the phone Doc tab', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const response = await peer.request.get(
          `/api/rounds/${roundId}/floor/messages?channelId=${channelId}`,
        );
        return (await response.json()).history.viewer.readSequence;
      })
      .toBe(newest.sequence);
  } finally {
    if (viewport) await peer.setViewportSize(viewport);
  }
}
