/**
 * The pre-parse scan for document HTML (ADR 0054, ISSUE-337). It accepts
 * only markup the document schema can produce, written strictly: every tag
 * from an allowlist, attributes with quoted values free of `<` and `>`, no
 * raw `<` or `>` in text, every close matching the innermost open element,
 * and nothing the HTML parser would close another element for. What it
 * accepts the parser therefore reads exactly as written, so the depth it
 * counts is the depth the parser builds. The editor always writes such
 * markup; anything else is refused before the recursive parse runs.
 */

/** Depth past which a document is refused; real documents stay far below it. */
export const MAX_DEPTH = 32;
/** Most elements accepted in one document. */
export const MAX_ELEMENTS = 3_000;

export type Scan = 'ok' | 'too-complex' | 'malformed';

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const VOID = new Set(['br', 'hr', 'input']);
/** The tags the schema parses or the editor writes (task items' label, input, div). */
const ALLOWED = new Set([
  ...HEADINGS,
  ...VOID,
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'div',
  'label',
  'span',
  'strong',
  'b',
  'em',
  'i',
  's',
  'del',
  'strike',
  'u',
]);
/** Start tags that make the parser close an open <p> in button scope first. */
const CLOSES_P = new Set([
  ...HEADINGS,
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'div',
  'hr',
]);

const ATTRIBUTE = `\\s+[^\\s"'<>/=]+(?:\\s*=\\s*(?:"[^"<>]*"|'[^'<>]*'|[^\\s"'=<>\`]+))?`;
const TAG = new RegExp(
  `<(/?)([a-zA-Z][\\w-]*)((?:${ATTRIBUTE})*)\\s*(/?)>`,
  'g',
);
const RAW = /[<>]/;

/** An li above the nearest list: the parser closes it when another li opens. */
const openItem = (open: readonly string[]) => {
  for (let at = open.length - 1; at >= 0; at -= 1) {
    if (open[at] === 'li') return true;
    if (open[at] === 'ul' || open[at] === 'ol') return false;
  }
  return false;
};

/** A start tag the parser would not nest where it is written. */
function impliesClose(open: readonly string[], name: string): boolean {
  if (CLOSES_P.has(name) && open.includes('p')) return true;
  if (name === 'li' && openItem(open)) return true;
  return HEADINGS.has(name) && HEADINGS.has(open.at(-1) ?? '');
}

type Step = { readonly open: string[]; readonly elements: number };

/** One tag's effect on the open stack, or the reason to refuse. */
function step(
  state: Step,
  closing: boolean,
  name: string,
  slash: boolean,
): Step | Scan {
  if (!ALLOWED.has(name)) return 'malformed';
  if (closing) return state.open.pop() === name ? state : 'malformed';
  if (impliesClose(state.open, name)) return 'malformed';
  if (VOID.has(name))
    // A void element sits one level inside what is open.
    return state.open.length + 1 > MAX_DEPTH
      ? 'too-complex'
      : { ...state, elements: state.elements + 1 };
  // The parser ignores "/>" on a non-void element and opens it.
  if (slash) return 'malformed';
  state.open.push(name);
  return { ...state, elements: state.elements + 1 };
}

/** Scans document HTML (without storage line breaks) before it is parsed. */
export function scanDocument(input: string): Scan {
  let state: Step = { open: [], elements: 0 };
  let last = 0;
  for (const match of input.matchAll(TAG)) {
    if (RAW.test(input.slice(last, match.index))) return 'malformed';
    last = match.index + match[0].length;
    const [, closing, rawName = '', , slash] = match;
    const next = step(
      state,
      closing === '/',
      rawName.toLowerCase(),
      slash === '/',
    );
    if (typeof next === 'string') return next;
    state = next;
    if (state.open.length > MAX_DEPTH || state.elements > MAX_ELEMENTS)
      return 'too-complex';
  }
  return RAW.test(input.slice(last)) ? 'malformed' : 'ok';
}
