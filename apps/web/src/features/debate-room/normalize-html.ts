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
      readonly reason: 'too-large' | 'not-html' | 'too-complex';
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

/**
 * A cheap linear scan before the recursive parse: refuses nesting deeper
 * than MAX_DEPTH or more than MAX_ELEMENTS elements, which would otherwise
 * overflow the stack or hold the event loop.
 */
function withinBounds(input: string): boolean {
  let depth = 0;
  let elements = 0;
  for (const [, closing, name = '', selfClosing] of input.matchAll(TAG)) {
    if (closing) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    elements += 1;
    if (!selfClosing && !VOID.has(name.toLowerCase())) depth += 1;
    if (depth > MAX_DEPTH || elements > MAX_ELEMENTS) return false;
  }
  return true;
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
  if (!withinBounds(input)) return { ok: false, reason: 'too-complex' };
  const html = roundTrip(input);
  if (html === null) return { ok: false, reason: 'not-html' };
  return { ok: true, html: breakLines(html === '' ? EMPTY : html) };
}
