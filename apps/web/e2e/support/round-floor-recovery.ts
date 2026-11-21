import type { Page, Response, Route } from '@playwright/test';
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
  const isDiscovery = (response: Response) =>
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname === `/api/rounds/${roundId}/floor`;
  const refused = page.waitForResponse(
    (response) => isDiscovery(response) && response.status() === 503,
    { timeout: 15_000 },
  );
  const retried = page.waitForResponse(
    (response) => isDiscovery(response) && response.status() === 200,
    { timeout: 15_000 },
  );
  // A failing document may leave the browser response waiters pending.
  void Promise.allSettled([refused, retried]);
  try {
    const document = await page.goto(`/rounds/${roundId}/floor`);
    expect(document?.status()).toBe(200);
    expect(
      (await document?.text())?.includes('Reconnecting to the Round'),
    ).toBe(true);
    const refusal = await refused;
    expect(refusal.headers()['retry-after']).toBe('1');
    const first = refusal.request().timing();
    expect(first.responseStart).toBeGreaterThanOrEqual(0);
    const retry = (await retried).request().timing();
    // Both timestamps come from Chromium. Allow 10 ms for timestamp rounding.
    expect(
      retry.startTime - (first.startTime + first.responseStart),
    ).toBeGreaterThanOrEqual(990);
  } finally {
    await page.unroute(path, refuseBrowserDiscovery);
  }
}
