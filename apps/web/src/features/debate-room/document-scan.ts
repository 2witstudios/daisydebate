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
const LOOSE_TAG = /<(\/?)([a-zA-Z][\w-]*)()[^>]*?(\/?)>/g;
const RAW = /[<>]/;

/**
 * The scan's defences, each closing one way the parser could nest deeper
 * than the scan counts. Production always runs all of them; the
 * differential test switches each off to prove it would catch the escape.
 */
export type Defences = {
  /** Tags only from the allowlist. */
  readonly allowlist: boolean;
  /** Quoted attribute values without < or >, so a value cannot hide a tag. */
  readonly strictAttributes: boolean;
  /** No raw < or > outside tags (comments, CDATA, stray markup). */
  readonly rawText: boolean;
  /** A close must match the innermost open element. */
  readonly matchingCloses: boolean;
  /** Refuse elements the parser would re-nest (p, li and heading closes). */
  readonly impliedCloses: boolean;
  /** "/>" only on void elements. */
  readonly selfClosing: boolean;
  /** A void element counts at its own depth. */
  readonly voidDepth: boolean;
};

export const allDefences: Defences = {
  allowlist: true,
  strictAttributes: true,
  rawText: true,
  matchingCloses: true,
  impliedCloses: true,
  selfClosing: true,
  voidDepth: true,
};

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

type Tag = {
  readonly closing: boolean;
  readonly name: string;
  readonly slash: boolean;
};

/** A close: it must match the innermost open element. */
function close(state: Step, name: string, defences: Defences): Step | Scan {
  const popped = state.open.pop();
  return popped === name || !defences.matchingCloses ? state : 'malformed';
}

/** A void element, or a non-void one written with "/>". */
function selfContained(state: Step, tag: Tag, defences: Defences): Step | Scan {
  // A void element sits one level inside what is open.
  const depth = state.open.length + (defences.voidDepth ? 1 : 0);
  if (VOID.has(tag.name))
    return depth > MAX_DEPTH
      ? 'too-complex'
      : { ...state, elements: state.elements + 1 };
  // The parser ignores "/>" on a non-void element and opens it.
  return defences.selfClosing
    ? 'malformed'
    : { ...state, elements: state.elements + 1 };
}

/** One tag's effect on the open stack, or the reason to refuse. */
function step(state: Step, tag: Tag, defences: Defences): Step | Scan {
  if (defences.allowlist && !ALLOWED.has(tag.name)) return 'malformed';
  if (tag.closing) return close(state, tag.name, defences);
  if (defences.impliedCloses && impliesClose(state.open, tag.name))
    return 'malformed';
  if (VOID.has(tag.name) || tag.slash)
    return selfContained(state, tag, defences);
  state.open.push(tag.name);
  return { ...state, elements: state.elements + 1 };
}

/** Text between tags: raw < or > is markup the scan did not read. */
const rawIn = (text: string, defences: Defences) =>
  defences.rawText && RAW.test(text);

/** Scans document HTML (without storage line breaks) before it is parsed. */
export function scanDocument(
  input: string,
  defences: Defences = allDefences,
): Scan {
  let state: Step = { open: [], elements: 0 };
  let last = 0;
  const tags = defences.strictAttributes ? TAG : LOOSE_TAG;
  for (const match of input.matchAll(tags)) {
    if (rawIn(input.slice(last, match.index), defences)) return 'malformed';
    last = match.index + match[0].length;
    const [, closing, rawName = '', , slash] = match;
    const tag = {
      closing: closing === '/',
      name: rawName.toLowerCase(),
      slash: slash === '/',
    };
    const next = step(state, tag, defences);
    if (typeof next === 'string') return next;
    state = next;
    if (state.open.length > MAX_DEPTH || state.elements > MAX_ELEMENTS)
      return 'too-complex';
  }
  return rawIn(input.slice(last), defences) ? 'malformed' : 'ok';
}
