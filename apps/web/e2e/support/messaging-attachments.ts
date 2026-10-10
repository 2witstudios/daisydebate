import type { Page } from '@playwright/test';
import { expect } from './fixtures';
/** Both actual JS modes POST native bytes, then a separate authenticated peer downloads. */
export async function attachNativeMessageFile(
  author: Page,
  peer: Page,
  channelId: string,
  text: string,
) {
  const attachmentLink = (page: Page) =>
    page
      .getByRole('listitem')
      .filter({ has: page.getByText(text, { exact: true }) })
      .getByRole('link', { name: 'Attachments', exact: true });
  await author
    .getByRole('listitem')
    .filter({ has: author.getByText(text, { exact: true }) })
    .getByRole('link', { name: 'Attach file', exact: true })
    .click();
  await author.getByLabel('Image or PDF', { exact: true }).setInputFiles({
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nprivate native browser content\n%%EOF'),
  });
  await author
    .getByRole('button', { name: 'Attach file', exact: true })
    .click();
  await expect(author).toHaveURL(new RegExp(`/messages/${channelId}$`));
  await peer.goto(`/messages/${channelId}`);
  await attachmentLink(peer).click();
  const file = peer.getByRole('link', { name: 'notes.pdf', exact: true });
  await expect(file).toHaveCount(1);
  const href = await file.getAttribute('href');
  if (!href) throw new Error('Authorized file projection unavailable');
  const download = await peer.request.get(href);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toBe('application/pdf');
  expect(download.headers()['location']).toBeUndefined();
  expect((await download.body()).toString()).toBe(
    '%PDF-1.7\nprivate native browser content\n%%EOF',
  );
  await peer.goto(`/messages/${channelId}`);
}
