import { markGeometry, petalShape } from '../../ui/brand/brand-geometry';
import { bloomPetals } from '../../ui/brand/petal';
import { colorSchemeFor } from '../../ui/theme/theme-preference';
import { confirmPageStylesheet } from './confirm-page-style';
import { escapeHtml } from './mail/escape';
import type { PageContext } from './confirm-http-shared';

export { escapeHtml };

/** Headers for every page that can carry or follow a credential. */
export const pageHeaders = (extra: Record<string, string> = {}) => ({
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  ...extra,
});

export const hiddenInput = (name: string, value: string | undefined) =>
  value === undefined
    ? ''
    : `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;

const { size: drawing, centre, discRadius } = markGeometry;

const petalPaths = (classOf: (cardinal: boolean) => string) =>
  bloomPetals(petalShape, markGeometry)
    .map(
      ({ d, cardinal }) =>
        `<path d="${d}" class="${classOf(cardinal)}"></path>`,
    )
    .join('');

/**
 * The primary Daisy mark (ADR 0045), drawn from the same geometry as
 * `ui/components/daisy-mark`: its petals follow the scheme through the
 * stylesheet, forest and sage on cream, cream on the dark page.
 */
const logoSvg = (size: number) =>
  `<svg class="af-logo" viewBox="0 0 ${drawing} ${drawing}" width="${size}" height="${size}" aria-hidden="true">${petalPaths((cardinal) => (cardinal ? 'af-logo-cardinal' : 'af-logo-diagonal'))}<circle class="af-logo-disc" cx="${centre}" cy="${centre}" r="${discRadius}"></circle></svg>`;

/** The reverse mark as the stage panel's art; its colours are in the stylesheet. */
const panelMarkSvg = () =>
  `<svg class="af-panel-mark" viewBox="0 0 ${drawing} ${drawing}" width="520" height="520" aria-hidden="true">${petalPaths(() => 'af-panel-petal')}<circle class="af-panel-disc" cx="${centre}" cy="${centre}" r="${discRadius}"></circle></svg>`;

export type PanelContent = {
  readonly kicker: string;
  readonly title: string;
};

/** The forest stage panel, hidden under the rail breakpoint (AUTH-4.7). */
const panel = (content: PanelContent | undefined) =>
  content
    ? `<aside class="af-panel" aria-hidden="true">${panelMarkSvg()}<p class="af-panel-kicker">${escapeHtml(content.kicker)}</p><p class="af-panel-title">${escapeHtml(content.title)}</p></aside>`
    : '';

export type AuthFrameContent = {
  readonly body: string;
  readonly footer: string;
  readonly panel?: PanelContent;
};

/**
 * Server-rendered, script-free AuthFrame layout, with no third-party or
 * external asset (the two fonts are same-origin, fixed-path files): the
 * brand row, the content column and the stage panel, matching the
 * approved design (artifact Nc1KBhwPeBhmUqK4UkqG1M). Nothing here is served
 * through the Next app's own stylesheet pipeline, so the whole visual layer
 * travels as one nonce'd `<style>` and this markup.
 */
function authFrame({ body, footer, panel: panelContent }: AuthFrameContent) {
  return (
    `<div class="af-page"><div class="af-main">` +
    `<a class="af-brand" href="/">${logoSvg(34)}<span class="af-word">Daisy Debate</span></a>` +
    `<div class="af-body">${body}</div>` +
    `<p class="af-foot">${footer}</p>` +
    `</div>${panel(panelContent)}</div>`
  );
}

/**
 * Server-rendered, script-free confirmation document with no third-party or
 * external asset: nothing to prefetch or leak. The `<style>` carries the
 * request's CSP nonce and is omitted entirely when no valid nonce was
 * provided (fail safe: the page still functions, just unstyled).
 */
export const confirmDocument = (
  title: string,
  content: AuthFrameContent,
  ctx: PageContext,
): string =>
  `<!doctype html><html lang="en" data-theme="${ctx.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><meta name="color-scheme" content="${colorSchemeFor(ctx.theme)}">${ctx.nonce ? `<style nonce="${ctx.nonce}">${confirmPageStylesheet()}</style>` : ''}<title>${escapeHtml(title)}</title></head><body><main>${authFrame(content)}</main></body></html>`;
