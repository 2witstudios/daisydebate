import { Window } from 'happy-dom';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { MAX_DEPTH } from './document-scan';
import { normalizeDocumentHtml } from './normalize-html';

setupRitewayBun();

/** A seeded generator (mulberry32): the same cases on every run. */
const seeded = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const ALLOWED = [
  'p',
  'h1',
  'h2',
  'ul',
  'ol',
  'li',
  'blockquote',
  'div',
  'strong',
  'em',
  's',
  'u',
  'span',
  'label',
];
const VOIDS = ['br', 'hr', 'input'];
const ATTRIBUTES = [
  '',
  '',
  '',
  ' data-debate-mark="aff"',
  ' data-checked="true" data-type="taskItem"',
  " type='a'",
];

const pickFrom =
  (random: () => number) =>
  <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)]!;

/** A mutation: the shapes that have fooled the scan, or might. */
const MUTATIONS = [
  (name: string) => `<${name}/>`,
  () => '</x>',
  () => '<!--</p>-->',
  () => '<!--',
  () => '<![CDATA[</li>]]>',
  () => '<script></blockquote></script>',
  () => '<textarea></p>',
  (name: string) => `<${name} data-x="></${name}>">`,
  (name: string) => `<${name} title='</${name}>'>`,
  (name: string) => `<${name} title="x>`,
  () => '<',
  () => '>',
  () => '</',
  () => 'a < b',
  (name: string) => `<${name}><${name}>`,
] as const;

const INLINE = ['strong', 'em', 's', 'u', 'span'];
const BLOCKS = ['p', 'h1', 'h2', 'ul', 'ol', 'blockquote', 'div'];
/** What may open inside each element, as the editor nests it. */
const CHILDREN: Readonly<Record<string, readonly string[]>> = {
  root: BLOCKS,
  blockquote: BLOCKS,
  div: BLOCKS,
  li: ['p', 'ul', 'ol', 'blockquote', 'div'],
  ul: ['li'],
  ol: ['li'],
  p: INLINE,
  h1: INLINE,
  h2: INLINE,
  label: INLINE,
  ...Object.fromEntries(INLINE.map((name) => [name, INLINE])),
};

/** Text, or a void element written with or without "/>", where text may go. */
const leaf = (pick: ReturnType<typeof pickFrom>, random: () => number) =>
  random() < 0.2
    ? `<${pick(VOIDS)}${random() < 0.5 ? '/' : ''}>`
    : pick(['x', 'word ', '&amp;', ' ', '&lt;p&gt;']);

/** Text may go where paragraphs and list items may not. */
const holdsText = (here: string) =>
  !CHILDREN[here]?.includes('p') && !CHILDREN[here]?.includes('li');

/** The next piece: a mutation, an allowed child, a close, or a leaf. */
function nextPiece(
  random: () => number,
  open: string[],
  mutationRate: number,
): string {
  const pick = pickFrom(random);
  const here = open.at(-1) ?? 'root';
  const roll = random();
  if (roll < mutationRate) return pick(MUTATIONS)(pick(ALLOWED));
  if (roll < 0.65) {
    const name = pick(CHILDREN[here] ?? INLINE);
    open.push(name);
    return `<${name}${pick(ATTRIBUTES)}>`;
  }
  if (roll < 0.85 && open.length > 0) return `</${open.pop()}>`;
  return holdsText(here) ? leaf(pick, random) : '';
}

/**
 * Nesting the editor would write, so the scan accepts many documents, with
 * a few mutations in half of them: what the scan accepts is then worth
 * comparing against the parser.
 */
const documentOf = (random: () => number): string => {
  const mutationRate = random() < 0.5 ? 0 : 0.02;
  const open: string[] = [];
  const length = 20 + Math.floor(random() * 260);
  const pieces = Array.from({ length }, () =>
    nextPiece(random, open, mutationRate),
  );
  return `<p>a</p>${pieces.join('')}`;
};

const window = new Window({
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    disableIframePageLoading: true,
    disableComputedStyleRendering: true,
  },
});

type Node = { readonly children: ArrayLike<Node> };

/** The deepest element nesting the real parser builds under body. */
const depthOf = (node: Node): number => {
  let deepest = 0;
  for (const child of Array.from(node.children))
    deepest = Math.max(deepest, 1 + depthOf(child));
  return deepest;
};

const parsedDepth = (html: string): number => {
  window.document.body.innerHTML = html;
  return depthOf(window.document.body as unknown as Node);
};

/** Refused before the parse: the scan saw too much depth or markup it does not read as the parser does. */
const refusedByScan = (html: string) => {
  const result = normalizeDocumentHtml(html);
  return !result.ok && result.reason !== 'not-html';
};

describe('normalizeDocumentHtml against the real parser', () => {
  test('whatever the scan accepts, the parser builds within the depth bound', () => {
    const random = seeded(337);
    const escapes = Array.from({ length: 3_000 }, () =>
      documentOf(random),
    ).flatMap((html) => {
      if (refusedByScan(html)) return [];
      const depth = parsedDepth(html);
      return depth > MAX_DEPTH ? [{ depth, html: html.slice(0, 160) }] : [];
    });
    assert({
      given:
        '3,000 seeded documents of allowed, stray, self-closed, hidden and quoted markup',
      should: 'never accept one the parser nests deeper than MAX_DEPTH',
      actual: escapes,
      expected: [],
    });
  });

  test('the comparison has teeth', () => {
    const random = seeded(337);
    const documents = Array.from({ length: 3_000 }, () => documentOf(random));
    const deep = documents.filter(
      (html) => parsedDepth(html) > MAX_DEPTH,
    ).length;
    const accepted = documents.filter((html) => !refusedByScan(html)).length;
    assert({
      given: 'the same seeded documents',
      should:
        'include hundreds the parser nests past MAX_DEPTH, and hundreds the scan accepts',
      actual: { deep: deep > 300, accepted: accepted > 300 },
      expected: { deep: true, accepted: true },
    });
  });
});
