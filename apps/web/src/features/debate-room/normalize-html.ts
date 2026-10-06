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
 * Closes the innermost open element with this name and everything opened
 * inside it, as an HTML parser does; a closing tag with no open match is
 * ignored, so stray closes never hide real nesting.
 */
function close(open: string[], name: string): void {
  const at = open.lastIndexOf(name);
  if (at !== -1) open.length = at;
}

/**
 * A cheap linear scan before the recursive parse: refuses nesting deeper
 * than MAX_DEPTH or more than MAX_ELEMENTS elements, which would otherwise
 * overflow the stack or hold the event loop.
 */
function withinBounds(input: string): boolean {
  const open: string[] = [];
  let elements = 0;
  for (const [, closing, rawName = '', selfClosing] of input.matchAll(TAG)) {
    const name = rawName.toLowerCase();
    if (closing) {
      close(open, name);
      continue;
    }
    elements += 1;
    if (!selfClosing && !VOID.has(name)) open.push(name);
    if (open.length > MAX_DEPTH || elements > MAX_ELEMENTS) return false;
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
