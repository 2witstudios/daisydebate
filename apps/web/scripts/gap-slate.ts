/**
 * Draws the Recording's gap slate: the still the recording worker holds where capture
 * stopped and restarted. It matches the stage's own slate (ground, faces, mark and
 * branding bar), so a gap joins the frames either side of it. Colours are read from
 * the theme and the mark from the brand geometry, so nothing here is a second copy.
 *
 *   bun apps/web/scripts/gap-slate.ts
 *
 * Run it after the stage slate's look changes, and commit the PNG it writes.
 */
import { chromium } from 'playwright-core';
import { markGeometry, petalShape } from '../src/features/brand/brand-geometry';
import { bloomPetals } from '../src/features/brand/petal';

const WIDTH = 1280;
const HEIGHT = 720;
const here = (path: string) => new URL(path, import.meta.url);
const OUTPUT = here('../../recording-worker/assets/gap-slate.png');

const theme = await Bun.file(here('../src/app/globals.css')).text();
/** A stage token's value; these are the same in both schemes. */
const token = (name: string) => {
  const found = new RegExp(`--${name}:\\s*light-dark\\((#[0-9a-f]{6}),`).exec(
    theme,
  );
  if (!found?.[1]) throw new Error(`No theme token --${name}`);
  return found[1];
};

const face = async (family: string, file: string) => {
  const bytes = await Bun.file(here(`../public/fonts/${file}`)).arrayBuffer();
  const data = Buffer.from(bytes).toString('base64');
  return `@font-face{font-family:'${family}';font-weight:100 900;src:url(data:font/woff2;base64,${data}) format('woff2')}`;
};

const mark = (size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 ${markGeometry.size} ${markGeometry.size}">${bloomPetals(
    petalShape,
    markGeometry,
    1,
  )
    .map(({ d }) => `<path d="${d}" fill="${token('cream')}"/>`)
    .join(
      '',
    )}<circle cx="${markGeometry.centre}" cy="${markGeometry.centre}" r="${markGeometry.discRadius}" fill="${token('yolk')}"/></svg>`;

const html = `<!doctype html><meta charset="utf-8"><style>
${await face('Fraunces', 'fraunces-latin.woff2')}
${await face('Instrument Sans', 'instrument-sans-latin.woff2')}
*{margin:0}
body{display:grid;grid-template-rows:1fr 48px;width:${WIDTH}px;height:${HEIGHT}px;background:${token('surface-stage')};color:${token('stage-text')};font-family:'Instrument Sans',sans-serif}
main{display:flex;flex-direction:column;gap:28px;align-items:center;justify-content:center}
h1{font-family:'Fraunces',serif;font-size:72px;font-weight:500;line-height:1;letter-spacing:-0.02em}
p{color:${token('stage-text-muted')};font-size:24px}
footer{display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:${token('stage-footer')};color:${token('stage-text-muted')};font-size:16px}
footer span:first-child{display:flex;gap:10px;align-items:center;color:${token('stage-text')};font-family:'Fraunces',serif;font-size:20px;font-weight:600}
</style><main><h1>This part was not recorded</h1><p>Capture stopped and restarted. The debate went on.</p></main><footer><span>${mark(24)}Daisy Debate</span><span>daisydebate.com</span></footer>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await Bun.write(OUTPUT, await page.screenshot({ type: 'png' }));
} finally {
  await browser.close();
}
