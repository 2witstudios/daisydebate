import { generateHTML, generateJSON } from '@tiptap/html/server';
import { breakLines, isHtmlDocument, joinLines } from './document-lines';
import { scanDocument } from './document-scan';
import { documentExtensions } from './document-schema';

/** Largest document body accepted, in UTF-8 bytes. */
export const DOCUMENT_MAX_BYTES = 200_000;

export type Normalized =
  | { readonly ok: true; readonly html: string }
  | {
      readonly ok: false;
      readonly reason: 'too-large' | 'not-html' | 'too-complex' | 'malformed';
    };

/** The schema round trip; a parser failure is a refusal, never a 500. */
function roundTrip(input: string): string | null {
  try {
    const json = generateJSON(input, documentExtensions);
    return generateHTML(json, documentExtensions);
  } catch {
    return null;
  }
}

const EMPTY = '<p></p>';

/**
 * Untrusted document HTML (from the editor or an agent) scanned, then parsed
 * through the document schema and serialized back, then line-broken for
 * storage. The scan (document-scan.ts) refuses anything the editor would not
 * write, so the parser reads exactly what was scanned and its depth is
 * bounded; the round trip drops whatever the schema does not know.
 */
export function normalizeDocumentHtml(input: string): Normalized {
  if (new TextEncoder().encode(input).length > DOCUMENT_MAX_BYTES)
    return { ok: false, reason: 'too-large' };
  if (input.trim() === '') return { ok: true, html: breakLines(EMPTY) };
  if (!isHtmlDocument(input)) return { ok: false, reason: 'not-html' };
  // Storage newlines sit beside tags; newlines inside text stay word breaks.
  const joined = joinLines(input);
  const scanned = scanDocument(joined);
  if (scanned !== 'ok') return { ok: false, reason: scanned };
  const html = roundTrip(joined);
  if (html === null) return { ok: false, reason: 'not-html' };
  return { ok: true, html: breakLines(html === '' ? EMPTY : html) };
}
