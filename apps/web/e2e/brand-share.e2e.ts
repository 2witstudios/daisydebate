import { expect, test } from './support/fixtures';

const pngSize = (bytes: Buffer) => [
  bytes.readUInt32BE(16),
  bytes.readUInt32BE(20),
];

test('public brand metadata and images are crawlable without a session', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    'content',
    'summary_large_image',
  );
  for (const [selector, expected] of [
    ['meta[property="og:image"]', [1200, 630]],
    ['meta[name="twitter:image"]', [1600, 900]],
    ['link[rel="icon"]', [32, 32]],
    ['link[rel="apple-touch-icon"]', [180, 180]],
  ] as const) {
    const node = page.locator(selector).first();
    const url = await node.getAttribute(
      selector.startsWith('meta') ? 'content' : 'href',
    );
    expect(url).toBeTruthy();
    const response = await request.get(new URL(url!, page.url()).href);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');
    expect(pngSize(await response.body())).toEqual(expected);
  }
  const favicon = await request.get('/favicon.ico');
  expect(favicon.status()).toBe(200);
  expect(pngSize(await favicon.body())).toEqual([32, 32]);
});

test('development share exports stay closed in production', async ({
  request,
}) => {
  for (const path of [
    '/foundation',
    '/foundation/share/og/light',
    '/foundation/share/story/dark',
  ])
    expect((await request.get(path)).status()).toBe(404);
});
