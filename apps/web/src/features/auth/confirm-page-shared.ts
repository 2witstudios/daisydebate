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

const petalAngles = [0, 45, 90, 135, 180, 225, 270, 315] as const;

const petals = () =>
  petalAngles
    .map(
      (angle) =>
        `<ellipse cx="12" cy="5.1" rx="2.3" ry="3.9" transform="rotate(${angle} 12 12)"></ellipse>`,
    )
    .join('');

/** The Daisy mark, matching `ui/components/daisy-mark`: eight filled petals
 * around a solid disc, drawn inline (no external asset). */
const daisyMarkSvg = (size: number, extraAttrs = '') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"${extraAttrs}><g fill="currentColor">${petals()}</g><circle cx="12" cy="12" r="2.4" fill="currentColor"></circle></svg>`;

export type PanelContent = {
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
};

/** The emerald side panel, hidden under the rail breakpoint (AUTH-4.7). */
const panel = (content: PanelContent | undefined) =>
  content
    ? `<aside class="af-panel" aria-hidden="true">${daisyMarkSvg(520, ' class="af-panel-mark"')}<p class="af-panel-kicker">${escapeHtml(content.kicker)}</p><p class="af-panel-title">${escapeHtml(content.title)}</p><p class="af-panel-body">${escapeHtml(content.body)}</p></aside>`
    : '';

export type AuthFrameContent = {
  readonly body: string;
  readonly footer: string;
  readonly panel?: PanelContent;
};

/**
 * Server-rendered, script-free and asset-free AuthFrame layout: the brand
 * row, the content column and the emerald panel, matching the approved
 * design (artifact Nc1KBhwPeBhmUqK4UkqG1M). Nothing here is served through
 * the Next app's own stylesheet pipeline, so the whole visual layer travels
 * as one nonce'd `<style>` and this markup.
 */
function authFrame({ body, footer, panel: panelContent }: AuthFrameContent) {
  return (
    `<div class="af-page"><div class="af-main">` +
    `<a class="af-brand" href="/"><span class="af-logo">${daisyMarkSvg(18)}</span><span class="af-word">Daisy</span></a>` +
    `<div class="af-body">${body}</div>` +
    `<p class="af-foot">${footer}</p>` +
    `</div>${panel(panelContent)}</div>`
  );
}

/**
 * Server-rendered, script-free and asset-free confirmation document: nothing
 * to prefetch or leak. The `<style>` carries the request's CSP nonce and is
 * omitted entirely when no valid nonce was provided (fail safe: the page
 * still functions, just unstyled).
 */
export const confirmDocument = (
  title: string,
  content: AuthFrameContent,
  ctx: PageContext,
): string =>
  `<!doctype html><html lang="en" data-theme="${ctx.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><meta name="color-scheme" content="${colorSchemeFor(ctx.theme)}">${ctx.nonce ? `<style nonce="${ctx.nonce}">${confirmPageStylesheet()}</style>` : ''}<title>${escapeHtml(title)}</title></head><body><main>${authFrame(content)}</main></body></html>`;
