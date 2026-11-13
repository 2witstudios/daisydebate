/**
 * Draws the Recording's gap slate: the still the recording worker holds where capture
 * stopped and restarted. It is the stage's own slate, drawn with the stage's own
 * stylesheet, tokens, branding bar and mark, so a gap joins the frames either side of
 * it and nothing here is a second copy of their look. This script's own are the two
 * lines of copy, the committed font files (the same faces the app serves), and the
 * three Tailwind utilities the mark and the bar use (`fill-cream`, `fill-yolk`,
 * `shrink-0`), written out below because no Tailwind build runs here. A class added
 * to either must be added there too; only the ground pixel is pinned by a test.
 *
 *   bun apps/web/scripts/gap-slate.ts
 *
 * Run it after the stage slate's look changes, and commit the PNG it writes.
 */
import { chromium } from 'playwright-core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StageFooter } from '../src/ui/broadcast/stage-footer';

const here = (path: string) => new URL(path, import.meta.url);
const OUTPUT = here('../../recording-worker/assets/gap-slate.png');

const theme = await Bun.file(here('../src/app/globals.css')).text();
/** Every colour token at its light value; the stage's are the same in both schemes. */
const tokens = [
  ...theme.matchAll(/(--[a-z-]+):\s*light-dark\((#[0-9a-f]{6}),/g),
]
  .map(([, name, value]) => `${name}:${value}`)
  .join(';');
/** The stage's utilities as plain classes: the stylesheet itself, not a copy of it. */
const stageStyles = (
  await Bun.file(here('../src/app/theme/broadcast-stage.css')).text()
).replaceAll(/@utility ([a-z-]+)/g, '.$1');

const face = async (family: string, file: string) => {
  const bytes = await Bun.file(here(`../public/fonts/${file}`)).arrayBuffer();
  const data = Buffer.from(bytes).toString('base64');
  return `@font-face{font-family:'${family}';font-weight:100 900;src:url(data:font/woff2;base64,${data}) format('woff2')}`;
};

// createElement, not JSX: this file also writes the page's <style>, which TSX may not.
const frame = renderToStaticMarkup(
  createElement(
    'div',
    { className: 'broadcast-stage' },
    createElement('header'),
    createElement('div'),
    createElement(
      'section',
      { className: 'broadcast-stage-slate' },
      createElement('h1', null, 'This part was not recorded'),
      createElement(
        'p',
        null,
        'Capture stopped and restarted. The debate went on.',
      ),
    ),
    createElement(StageFooter, { siteLink: 'daisydebate.com' }),
  ),
);

const html = `<!doctype html><meta charset="utf-8"><style>
${await face('Fraunces', 'fraunces-latin.woff2')}
${await face('Instrument Sans', 'instrument-sans-latin.woff2')}
:root{${tokens};--font-display:'Fraunces',serif;--font-body:'Instrument Sans',sans-serif}
body{margin:0}
.fill-cream{fill:var(--cream)}.fill-yolk{fill:var(--yolk)}.shrink-0{flex-shrink:0}
${stageStyles}
</style>${frame}`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await Bun.write(OUTPUT, await page.screenshot({ type: 'png' }));
} finally {
  await browser.close();
}
