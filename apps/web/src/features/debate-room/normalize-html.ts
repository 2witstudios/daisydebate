import { generateHTML, generateJSON } from '@tiptap/html/server';
import { breakLines, isHtmlDocument, joinLines } from './document-lines';
import { documentExtensions } from './document-schema';

/** Largest document body accepted, in UTF-8 bytes. */
export const DOCUMENT_MAX_BYTES = 200_000;

/** Deepest element nesting accepted; real documents stay far below it. */
export const MAX_DEPTH = 32;
/** Most elements accepted in one document. */
export const MAX_ELEMENTS = 3_000;

export type Normalized =
  | { readonly ok: true; readonly html: string }
  | {
      readonly ok: false;
      readonly reason: 'too-large' | 'not-html' | 'too-complex' | 'malformed';
    };

const VOID = new Set([
  'br',
  'hr',
  'img',
  'input',
  'wbr',
  'col',
  'area',
  'source',
  'embed',
  'meta',
  'link',
  'base',
  'track',
  'param',
]);
const TAG = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;

/** Elements whose opening makes the HTML parser close an open `<p>` first. */
const CLOSES_P = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'div',
  'dl',
  'fieldset',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

type Scan = 'ok' | 'too-complex' | 'malformed';

/** An opening tag the parser would read differently from its nesting as written. */
const impliesClose = (open: readonly string[], name: string) =>
  (open.at(-1) === 'p' && CLOSES_P.has(name)) ||
  (open.at(-1) === 'li' && name === 'li');

/**
 * A cheap linear scan before the recursive parse. It accepts only strictly
 * nested HTML, which the editor always writes: every close matches the
 * innermost open element, and nothing opens that the parser would close
 * an element for, so the scanned depth is the depth the parser builds.
 * Nesting deeper than MAX_DEPTH or more than MAX_ELEMENTS elements would
 * otherwise overflow the stack or hold the event loop.
 */
function scan(input: string): Scan {
  const open: string[] = [];
  let elements = 0;
  for (const [, closing, rawName = '', selfClosing] of input.matchAll(TAG)) {
    const name = rawName.toLowerCase();
    if (closing) {
      if (open.pop() !== name) return 'malformed';
      continue;
    }
    if (impliesClose(open, name)) return 'malformed';
    elements += 1;
    if (!selfClosing && !VOID.has(name)) open.push(name);
    if (open.length > MAX_DEPTH || elements > MAX_ELEMENTS)
      return 'too-complex';
  }
  return 'ok';
}

/** The schema round trip; a parser failure is a refusal, never a 500. */
function roundTrip(input: string): string | null {
  try {
    // Storage newlines sit beside tags; newlines inside text stay word breaks.
    const json = generateJSON(joinLines(input), documentExtensions);
    return generateHTML(json, documentExtensions);
  } catch {
    return null;
  }
}

const EMPTY = '<p></p>';

/**
 * Untrusted document HTML (from the editor or an agent) parsed through the
 * document schema and serialized back, then line-broken for storage.
 * Anything the schema does not know (scripts, style attributes, unknown
 * tags, event handlers) does not survive the round trip.
 */
export function normalizeDocumentHtml(input: string): Normalized {
  if (new TextEncoder().encode(input).length > DOCUMENT_MAX_BYTES)
    return { ok: false, reason: 'too-large' };
  if (input.trim() === '') return { ok: true, html: breakLines(EMPTY) };
  if (!isHtmlDocument(input)) return { ok: false, reason: 'not-html' };
  const scanned = scan(joinLines(input));
  if (scanned !== 'ok') return { ok: false, reason: scanned };
  const html = roundTrip(input);
  if (html === null) return { ok: false, reason: 'not-html' };
  return { ok: true, html: breakLines(html === '' ? EMPTY : html) };
}
