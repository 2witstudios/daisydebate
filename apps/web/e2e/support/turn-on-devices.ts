import { expect, type Page } from '@playwright/test';

/**
 * The tile's one button turns on the camera and microphone (ADR 0145). Both
 * passed when it gives way to I'm ready; a failed device stays named in an
 * alert, which the error carries.
 */
export async function turnOnDevices(page: Page, timeout = 15_000) {
  const turnOn = page.getByRole('button', {
    name: 'Turn on camera and mic',
    exact: true,
  });
  await turnOn.click({ timeout });
  try {
    await expect(turnOn).toBeHidden({ timeout });
  } catch (cause) {
    const alerts = await page.getByRole('alert').allInnerTexts();
    throw new Error(
      `Turn on camera and mic did not pass: ${JSON.stringify(alerts)}`,
      { cause },
    );
  }
}
