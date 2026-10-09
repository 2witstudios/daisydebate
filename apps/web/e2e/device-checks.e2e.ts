import { expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPage, test } from './support/fixtures';
import { deviceCheckHarnessEntry } from './support/device-check-harness';

let script: string;
test.beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), 'daisy-device-check-'));
  try {
    const file = join(directory, 'checks.js');
    execFileSync(
      'bun',
      [
        'build',
        deviceCheckHarnessEntry,
        '--target=browser',
        `--outfile=${file}`,
      ],
      { stdio: 'pipe' },
    );
    script = readFileSync(file, 'utf8');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
async function harness(page: import('@playwright/test').Page) {
  await page.route('**/rooms/device-controller-proof', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: {
        'Permissions-Policy':
          'camera=(self), microphone=(self), geolocation=()',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self'; media-src blob:; connect-src 'none'",
      },
      body: '<!doctype html><button id="camera">Check camera</button><button id="microphone">Check microphone</button><button id="select">Change camera</button><button id="stop">End camera</button><button id="mute">Policy mute</button><button id="dispose">Transition</button><output></output><script src="/device-check-proof.js"></script>',
    }),
  );
  await page.route('**/device-check-proof.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: script }),
  );
  await page.goto('/rooms/device-controller-proof');
}
async function checkBoth(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Check camera', exact: true }).click();
  await page
    .getByRole('button', { name: 'Check microphone', exact: true })
    .click();
  await expect(page.locator('output')).toContainText('"devicesPassed":true');
}

test('real controlled browser inputs pass; policy mute stays healthy; native track loss invalidates', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  try {
    await context.grantPermissions(['camera', 'microphone'], {
      origin: baseURL!,
    });
    const page = await openPage(
      context,
      'local controller actual browser input',
    );
    await harness(page);
    await checkBoth(page);
    await page
      .getByRole('button', { name: 'Policy mute', exact: true })
      .click();
    await expect(page.locator('output')).toContainText('"devicesPassed":true');
    await page.getByRole('button', { name: 'End camera', exact: true }).click();
    await expect(page.locator('output')).toContainText(
      '"cameraReason":"track-ended"',
    );
    await expect(page.locator('output')).toContainText('"devicesPassed":false');
    await page.getByRole('button', { name: 'Transition', exact: true }).click();
  } finally {
    await context.close();
  }
});
test('actual permission refusal is denied, never passed', async ({
  browser,
}) => {
  const context = await browser.newContext();
  try {
    const page = await openPage(context, 'camera permission refusal');
    await harness(page);
    const session = await context.newCDPSession(page);
    await session.send('Browser.setPermission', {
      permission: { name: 'videoCapture' },
      setting: 'denied',
      origin: new URL(page.url()).origin,
    });
    await page
      .getByRole('button', { name: 'Check camera', exact: true })
      .click();
    await expect(page.locator('output')).toContainText('"camera":"denied"');
    await expect(page.locator('output')).toContainText('"devicesPassed":false');
  } finally {
    await context.close();
  }
});
test('selected missing device invalidates and refuses acquisition', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  try {
    await context.grantPermissions(['camera', 'microphone'], {
      origin: baseURL!,
    });
    const page = await openPage(context, 'unavailable selected camera');
    await harness(page);
    await checkBoth(page);
    await page
      .getByRole('button', { name: 'Change camera', exact: true })
      .click();
    await expect(page.locator('output')).toContainText('"camera":"unchecked"');
    await expect(page.locator('output')).toContainText('"devicesPassed":false');
    await page
      .getByRole('button', { name: 'Check camera', exact: true })
      .click();
    await expect(page.locator('output')).toContainText(
      '"camera":"unavailable"',
    );
  } finally {
    await context.close();
  }
});
test('production resolves room override and retains deny-all elsewhere', async ({
  request,
}) => {
  for (const [path, expected] of [
    [
      '/rooms/device-controller-proof',
      'camera=(self), microphone=(self), geolocation=()',
    ],
    ['/rooms', 'camera=(), microphone=(), geolocation=()'],
    ['/ai-debate/retired', 'camera=(), microphone=(), geolocation=()'],
    ['/rooms/a/nested', 'camera=(), microphone=(), geolocation=()'],
  ] as const) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()['permissions-policy']).toBe(expected);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['x-frame-options']).toBe('DENY');
  }
});
