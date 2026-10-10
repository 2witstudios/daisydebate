import type { Page } from '@playwright/test';
import sharp from 'sharp';
import { expect } from './fixtures';
type NativeSample = { name: string; mimeType: string; buffer: Buffer };
const historyItem = (page: Page, text: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByText(text, { exact: true }) });
async function openPeerAttachments(
  author: Page,
  peer: Page,
  channelId: string,
  text: string,
) {
  await expect(author).toHaveURL(new RegExp(`/messages/${channelId}$`));
  await peer.goto(`/messages/${channelId}`);
  await historyItem(peer, text)
    .getByRole('link', { name: 'Attachments', exact: true })
    .click();
}
async function attachAndDownload(
  author: Page,
  peer: Page,
  channelId: string,
  text: string,
  sample: NativeSample,
) {
  await submitNativeFile(author, text, sample);
  await openPeerAttachments(author, peer, channelId, text);
  const file = peer.getByRole('link', { name: sample.name, exact: true });
  await expect(file).toHaveCount(1);
  const href = await file.getAttribute('href');
  if (!href) throw new Error('Authorized file projection unavailable');
  const download = await peer.request.get(href);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toBe(sample.mimeType);
  expect(download.headers()['location']).toBeUndefined();
  const bytes = await download.body();
  await author.goto(`/messages/${channelId}`);
  await peer.goto(`/messages/${channelId}`);
  return bytes;
}
async function submitNativeFile(
  author: Page,
  text: string,
  sample: NativeSample,
) {
  await historyItem(author, text)
    .getByRole('link', { name: 'Attach file', exact: true })
    .click();
  await author
    .getByLabel('Image or PDF', { exact: true })
    .setInputFiles(sample);
  await author
    .getByRole('button', { name: 'Attach file', exact: true })
    .click();
}
async function refuseOverflowAttachment(
  author: Page,
  peer: Page,
  channelId: string,
  text: string,
  buffer: Buffer,
) {
  await submitNativeFile(author, text, {
    name: 'overflow.pdf',
    mimeType: 'application/pdf',
    buffer,
  });
  await expect(author.getByRole('status')).toHaveText(
    'Could not attach the file. Choose it again to retry.',
  );
  await expect(author.getByLabel('Image or PDF', { exact: true })).toHaveValue(
    '',
  );
  await author
    .getByRole('button', { name: 'Discard pending upload', exact: true })
    .click();
  await openPeerAttachments(author, peer, channelId, text);
  await expect(
    peer.getByRole('link', { name: 'overflow.pdf', exact: true }),
  ).toHaveCount(0);
  for (const name of ['notes.pdf', 'photo.jpg'])
    await expect(peer.getByRole('link', { name, exact: true })).toHaveCount(1);
  await peer.goto(`/messages/${channelId}`);
}
/** Both JS modes POST native bytes, then a separate authenticated peer downloads. */
export async function attachNativeMessageFile(
  author: Page,
  peer: Page,
  channelId: string,
  text: string,
) {
  const pdf = '%PDF-1.7\nprivate native browser content\n%%EOF';
  const pdfBytes = await attachAndDownload(author, peer, channelId, text, {
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(pdf),
  });
  expect(pdfBytes.toString()).toBe(pdf);
  const image = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 12, g: 34, b: 56, alpha: 1 },
    },
  })
    .withExif({ IFD0: { Copyright: 'Private native fixture' } })
    .jpeg()
    .toBuffer();
  expect((await sharp(image).metadata()).exif).toBeDefined();
  const imageBytes = await attachAndDownload(author, peer, channelId, text, {
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: image,
  });
  const metadata = await sharp(imageBytes).metadata();
  expect([metadata.width, metadata.height, metadata.exif]).toEqual([
    2,
    2,
    undefined,
  ]);
  await refuseOverflowAttachment(
    author,
    peer,
    channelId,
    text,
    Buffer.from(pdf),
  );
}
