import { escapeHtml } from './mail/escape';

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

/** A script-free, asset-free confirmation document: nothing to prefetch or leak. */
export const confirmDocument = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body><main>${body}</main></body></html>`;
