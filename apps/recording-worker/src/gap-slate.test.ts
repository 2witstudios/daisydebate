import { inflateSync } from 'node:zlib';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

/** The top-left pixel of an 8-bit PNG: its first scanline's first bytes, whatever the filter. */
const firstPixel = (png: Buffer) => {
  const data: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT')
      data.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  return inflateSync(Buffer.concat(data)).subarray(1, 4).toString('hex');
};

test('the gap slate stands on the stage slate’s own ground', async () => {
  const theme = await Bun.file(
    new URL('../../web/src/app/globals.css', import.meta.url),
  ).text();
  const slate = Buffer.from(
    await Bun.file(
      new URL('../assets/gap-slate.png', import.meta.url),
    ).arrayBuffer(),
  );
  assert({
    given: 'the committed gap slate and the web theme’s stage surface',
    should:
      'share a ground, so a gap joins the slates either side; redraw it with apps/web/scripts/gap-slate.ts',
    actual: `#${firstPixel(slate)}`,
    expected: /--surface-stage:\s*light-dark\((#[0-9a-f]{6}),/.exec(theme)?.[1],
  });
});
