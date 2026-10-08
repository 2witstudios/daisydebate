/**
 * Line-addressed HTML documents (ADR 0054). A document is stored in the
 * line-broken form the AI reads, so a line number means the same thing to
 * every reader and writer. Breaking lines only ever adds newlines, so it is
 * idempotent: editor output (no newlines) and AI output (already broken)
 * settle into the same stored text.
 */

const BLOCK = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'div',
  'label',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
]);
// A whole tag: quoted attribute values may hold ">" or tag-like text.
const ATTRIBUTES = `(?:\\s(?:[^>"']|"[^"]*"|'[^']*')*)?`;
const TAG = new RegExp(`<(/?)([a-zA-Z][\\w-]*)${ATTRIBUTES}/?>`, 'g');
const HTML_DOCUMENT = new RegExp(
  `^\\s*<(?:${[...BLOCK].join('|')})${ATTRIBUTES}>`,
);

/** True when the text opens with a block tag; anchored, never "contains a tag". */
export const isHtmlDocument = (text: string): boolean =>
  HTML_DOCUMENT.test(text);

const breaksAfter = (name: string) =>
  BLOCK.has(name) || name === 'br' || name === 'hr';

/**
 * Puts each block tag on its own line, adding newlines and removing none.
 * Tags are read whole, so nothing inside an attribute value is ever split.
 */
export function breakLines(html: string): string {
  if (!isHtmlDocument(html)) return html;
  let out = '';
  let last = 0;
  for (const match of html.matchAll(TAG)) {
    const [tag, closing, rawName = ''] = match;
    const name = rawName.toLowerCase();
    const end = match.index + tag.length;
    out += html.slice(last, match.index);
    if (closing && BLOCK.has(name) && !out.endsWith('\n')) out += '\n';
    out += tag;
    if (breaksAfter(name) && html[end] !== '\n') out += '\n';
    last = end;
  }
  return (out + html.slice(last)).replace(/\n+$/, '');
}

/** Removes the storage newlines beside tags; newlines inside text stay. */
export const joinLines = (html: string): string =>
  html.replace(/\n(?=<)|(?<=>)\n/g, '');

/** True when two HTML strings differ only by storage line breaks. */
export const sameDocumentHtml = (a: string, b: string): boolean =>
  joinLines(a) === joinLines(b);

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

/**
 * Inserts `content` before or after the first line containing `anchor`;
 * `expectedTotalLines`, when given, refuses an edit to a changed document.
 */
export function insertAtAnchor(
  html: string,
  edit: {
    readonly anchor: string;
    readonly content: string;
    readonly position: 'before' | 'after';
    readonly expectedTotalLines?: number;
  },
): LineEdit {
  const lines = linesOf(html);
  if (
    edit.expectedTotalLines !== undefined &&
    edit.expectedTotalLines !== lines.length
  )
    return { ok: false, reason: 'stale', totalLines: lines.length };
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
