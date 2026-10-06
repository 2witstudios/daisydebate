/**
 * Line-addressed HTML documents (ADR 0054). A document is stored in the
 * line-broken form the AI reads, so a line number means the same thing to
 * every reader and writer. Breaking lines only ever adds newlines, so it is
 * idempotent: editor output (no newlines) and AI output (already broken)
 * settle into the same stored text.
 */

const BLOCK =
  'p|h[1-6]|ul|ol|li|blockquote|pre|div|label|table|thead|tbody|tr|td|th';
const OPENING = new RegExp(`(<(?:${BLOCK})(?:\\s[^>]*)?>)(?!\\n)`, 'g');
const CLOSING = new RegExp(`(?<!\\n)(</(?:${BLOCK})>)`, 'g');
const BETWEEN = new RegExp(`(</(?:${BLOCK})>)(?!\\n)`, 'g');
const VOID = /(<(?:br|hr)\s*\/?>)(?!\n)/g;
const HTML_DOCUMENT = new RegExp(`^\\s*<(?:${BLOCK})(?:\\s[^>]*)?>`);

/** True when the text opens with a block tag; anchored, never "contains a tag". */
export const isHtmlDocument = (text: string): boolean =>
  HTML_DOCUMENT.test(text);

/** Puts each block tag on its own line, adding newlines and removing none. */
export function breakLines(html: string): string {
  if (!isHtmlDocument(html)) return html;
  return html
    .replace(OPENING, '$1\n')
    .replace(CLOSING, '\n$1')
    .replace(BETWEEN, '$1\n')
    .replace(VOID, '$1\n')
    .replace(/\n+$/, '');
}

/** The stored lines, one per array entry. */
export const linesOf = (html: string): readonly string[] =>
  html === '' ? [] : breakLines(html).split('\n');

/** "n→line" numbering, as the AI reads a document. */
export const numberedLines = (html: string): string =>
  linesOf(html)
    .map((line, index) => `${index + 1}→${line}`)
    .join('\n');

export type LineEdit =
  | { readonly ok: true; readonly html: string; readonly totalLines: number }
  | {
      readonly ok: false;
      readonly reason: 'stale' | 'range';
      readonly totalLines: number;
    };

/**
 * Replaces lines start..end (1-based, inclusive) with `content`; an empty
 * `content` deletes them. `expectedTotalLines`, when given, refuses an edit
 * addressed to a document that changed since it was read.
 */
export function replaceLines(
  html: string,
  edit: {
    readonly start: number;
    readonly end?: number;
    readonly content: string;
    readonly expectedTotalLines?: number;
  },
): LineEdit {
  const lines = linesOf(html);
  const total = lines.length;
  if (
    edit.expectedTotalLines !== undefined &&
    edit.expectedTotalLines !== total
  )
    return { ok: false, reason: 'stale', totalLines: total };
  const end = edit.end ?? edit.start;
  if (
    !Number.isInteger(edit.start) ||
    edit.start < 1 ||
    end < edit.start ||
    end > total
  )
    return { ok: false, reason: 'range', totalLines: total };
  const inserted = edit.content === '' ? [] : edit.content.split('\n');
  const stored = breakLines(
    [...lines.slice(0, edit.start - 1), ...inserted, ...lines.slice(end)].join(
      '\n',
    ),
  );
  return { ok: true, html: stored, totalLines: linesOf(stored).length };
}

/** Inserts `content` before or after the first line containing `anchor`. */
export function insertAtAnchor(
  html: string,
  edit: {
    readonly anchor: string;
    readonly content: string;
    readonly position: 'before' | 'after';
  },
): LineEdit {
  const lines = linesOf(html);
  const at = lines.findIndex((line) => line.includes(edit.anchor));
  if (edit.anchor === '' || at === -1)
    return { ok: false, reason: 'range', totalLines: lines.length };
  const index = edit.position === 'before' ? at : at + 1;
  const stored = breakLines(
    [
      ...lines.slice(0, index),
      ...edit.content.split('\n'),
      ...lines.slice(index),
    ].join('\n'),
  );
  return { ok: true, html: stored, totalLines: linesOf(stored).length };
}
