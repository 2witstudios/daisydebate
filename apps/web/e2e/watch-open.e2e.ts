import { expect, test } from './support/fixtures';

test('Watch and Recordings are open to a visitor', async ({ request }) => {
  for (const route of ['/watch', '/recordings']) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
  }
});
