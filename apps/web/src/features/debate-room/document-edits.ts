import { escapeHtml } from './documents';

/** An agent's proposed change: lines it takes out and lines it puts in. */
export type Proposal = {
  readonly removed: readonly string[];
  readonly added: readonly string[];
};

type Block = {
  readonly kind: 'li' | 'p';
  readonly start: number;
  readonly end: number;
};

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const decodeEntity = (entity: string, body: string): string => {
  if (body.startsWith('#x'))
    return String.fromCodePoint(parseInt(body.slice(2), 16));
  if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
  return ENTITIES[body] ?? entity;
};

/** A block's visible text: tags stripped, entities decoded, whitespace collapsed. */
export const blockText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replace(/\s+/g, ' ')
    .trim();

const normalize = (line: string): string => line.replace(/\s+/g, ' ').trim();

/** Every list item and paragraph, list items first, each in document order. */
const blocksOf = (html: string): readonly Block[] => {
  const open: { kind: Block['kind']; start: number }[] = [];
  const blocks: Block[] = [];
  for (const tag of html.matchAll(/<(\/?)(li|p)(?:\s[^>]*)?>/g)) {
    const kind = tag[2] as Block['kind'];
    if (tag[1] === '') open.push({ kind, start: tag.index });
    else {
      const opened = open.pop();
      if (opened?.kind === kind)
        blocks.push({
          kind,
          start: opened.start,
          end: tag.index + tag[0].length,
        });
    }
  }
  const ordered = (kind: Block['kind']) =>
    blocks.filter((b) => b.kind === kind).sort((a, b) => a.start - b.start);
  return [...ordered('li'), ...ordered('p')];
};

const overlaps = (a: Block, b: Block): boolean =>
  a.start < b.end && b.start < a.end;

/** The blocks the removed lines name, one block per line, none overlapping. */
const matchRemoved = (
  html: string,
  removed: readonly string[],
): readonly Block[] => {
  const blocks = blocksOf(html);
  return removed.reduce<readonly Block[]>((chosen, line) => {
    const target = normalize(line);
    const found = blocks.find(
      (block) =>
        !chosen.some((taken) => overlaps(taken, block)) &&
        blockText(html.slice(block.start, block.end)) === target,
    );
    return found ? [...chosen, found] : chosen;
  }, []);
};

const asItems = (lines: readonly string[]): string =>
  lines.map((line) => `<li><p>${escapeHtml(line)}</p></li>`).join('');

const asParagraphs = (lines: readonly string[]): string =>
  lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');

/** Appends lines to a document as one bullet list. */
export function appendBullets(html: string, lines: readonly string[]): string {
  return lines.length === 0 ? html : `${html}<ul>${asItems(lines)}</ul>`;
}

/**
 * Applies both halves of a proposal: the added lines take the place of the
 * first removed block (bullets for a list item, paragraphs otherwise) and the
 * other removed blocks go. With nothing to remove, or nothing found, the
 * added lines are appended.
 */
export function applyProposal(html: string, proposal: Proposal): string {
  const matched = matchRemoved(html, proposal.removed);
  const [first] = matched;
  if (first === undefined) return appendBullets(html, proposal.added);
  const replacement =
    first.kind === 'li'
      ? asItems(proposal.added)
      : asParagraphs(proposal.added);
  return [...matched]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (text, block) =>
        text.slice(0, block.start) +
        (block === first ? replacement : '') +
        text.slice(block.end),
      html,
    );
}
