import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { ShareCanvas, shareFormats } from '../ui/brand/share-canvas';

/** Local, licensed font bytes: image generation never calls a font service. */
const fonts = Promise.all([
  readFile(join(process.cwd(), 'public/fonts/fraunces-display-semibold.woff')),
  readFile(join(process.cwd(), 'public/fonts/instrument-sans-regular.woff')),
]).then(([display, sans]) => [
  {
    name: 'Fraunces',
    data: display,
    weight: 600 as const,
    style: 'normal' as const,
  },
  {
    name: 'Instrument Sans',
    data: sans,
    weight: 400 as const,
    style: 'normal' as const,
  },
]);

export async function renderShareImage(
  format: keyof typeof shareFormats,
  scheme: 'light' | 'dark' = 'light',
) {
  return new ImageResponse(<ShareCanvas format={format} scheme={scheme} />, {
    ...shareFormats[format],
    fonts: await fonts,
  });
}
