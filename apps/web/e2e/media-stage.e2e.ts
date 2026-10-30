import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from './support/fixtures';

test('speaking wrappers retain attachment while SDK replacement and unmount detach', async ({
  page,
}) => {
  const bundle = execFileSync(
    'bun',
    [
      'build',
      resolve(import.meta.dirname, 'support/media-stage-fixture.tsx'),
      '--target=browser',
      '--minify',
    ],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  await page.route('**/media-stage-component-proof', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }),
  );
  await page.goto('/media-stage-component-proof');
  await page.addScriptTag({ content: bundle });
  const render = (index: number, speaking: boolean) =>
    page.evaluate(
      ({ index, speaking }) =>
        (
          window as unknown as {
            stage: { render(i: number, s: boolean): string[] };
          }
        ).stage.render(index, speaking),
      { index, speaking },
    );
  expect(await render(0, false)).toEqual(['attach first']);
  const video = await page.locator('video').elementHandle();
  expect(await render(0, true)).toEqual(['attach first']);
  expect(await render(0, false)).toEqual(['attach first']);
  expect(
    await video!.evaluate((node) => node === document.querySelector('video')),
  ).toBe(true);
  expect(await render(1, false)).toEqual([
    'attach first',
    'detach first',
    'attach second',
  ]);
  expect(
    await page.evaluate(() =>
      (window as unknown as { stage: { unmount(): string[] } }).stage.unmount(),
    ),
  ).toEqual(['attach first', 'detach first', 'attach second', 'detach second']);
});
