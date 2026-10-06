import { generateHTML, generateJSON } from '@tiptap/html/server';
import { breakLines, isHtmlDocument } from './document-lines';
import { documentExtensions } from './document-schema';

/** Largest document body accepted, in UTF-8 bytes. */
export const DOCUMENT_MAX_BYTES = 200_000;

export type Normalized =
  | { readonly ok: true; readonly html: string }
  | { readonly ok: false; readonly reason: 'too-large' | 'not-html' };

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
  // Storage newlines sit beside tags; newlines inside text stay word breaks.
  const json = generateJSON(
    input.replace(/\n(?=<)|(?<=>)\n/g, ''),
    documentExtensions,
  );
  const html = generateHTML(json, documentExtensions);
  return { ok: true, html: breakLines(html === '' ? EMPTY : html) };
}
