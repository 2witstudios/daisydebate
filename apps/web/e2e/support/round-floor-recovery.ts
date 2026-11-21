import type { Page, Route } from '@playwright/test';
import { expect } from './fixtures';
import { messagingRecoveryControlPath } from './messaging-recovery-control';
import { callLaunchControl } from './room-launch-settled';

/** Each refusal goes through the real handler and leaves the next discovery free to run. */
export async function openFloorThroughRefusals(
  page: Page,
  roundId: string,
  actorId: string,
) {
  const arm = () =>
    callLaunchControl(
      messagingRecoveryControlPath(Number(process.env.E2E_PORT)),
      'refuse-floor-discovery-once',
      JSON.stringify({ roundId, actorId }),
    );
  const path = `**/api/rounds/${roundId}/floor`;
  await page.goto('about:blank');
  await arm();
  const refuseBrowserDiscovery = async (route: Route) => {
    await arm();
    await route.continue();
  };
  await page.route(path, refuseBrowserDiscovery, { times: 1 });
  const discovery = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `/api/rounds/${roundId}/floor`,
  );
  // An early navigation failure may leave this waiter pending until teardown.
  void discovery.catch(() => undefined);
  try {
    const document = await page.goto(`/rounds/${roundId}/floor`);
    expect(document?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'Reconnecting to the Round' }),
    ).toBeVisible();
    const refusal = await discovery;
    expect(refusal.status()).toBe(503);
    expect(refusal.headers()['retry-after']).toBe('1');
  } finally {
    await page.unroute(path, refuseBrowserDiscovery);
  }
}
