import type { Page, Route } from '@playwright/test';
import { expect } from './fixtures';

/** The device tile must not move Settings between its pointer check and click. */
export async function proveStableDeviceHydration(page: Page) {
  let release = () => {};
  const hydration = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holdScripts = async (route: Route) => {
    if (route.request().resourceType() === 'script') await hydration;
    await route.continue();
  };
  await page.route('**/_next/static/**', holdScripts);
  try {
    await page.reload({ waitUntil: 'commit' });
    await expect(
      page.getByText('Checking your camera and microphone…', { exact: true }),
    ).toBeVisible();
    const turnOn = page.getByRole('button', {
      name: 'Turn on camera and mic',
      exact: true,
    });
    await expect(turnOn).toBeDisabled();
    const settings = page.getByRole('link', {
      name: 'Edit settings',
      exact: true,
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await settings.scrollIntoViewIfNeeded();
    const before = await settings.boundingBox();
    expect(before).not.toBeNull();
    release();
    await expect(turnOn).toBeEnabled();
    const after = await settings.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.x).toBeCloseTo(before!.x, 1);
    expect(after!.y).toBeCloseTo(before!.y, 1);
    expect(after!.width).toBeCloseTo(before!.width, 1);
    expect(after!.height).toBeCloseTo(before!.height, 1);
  } finally {
    release();
    await page.unroute('**/_next/static/**', holdScripts);
  }
}
