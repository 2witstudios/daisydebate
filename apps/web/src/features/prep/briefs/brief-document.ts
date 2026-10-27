import { escapeHtml } from '../../debate-room/documents/documents';
import { sideLabel } from '../library/library-item';
import {
  budget,
  readSeconds,
  trimWords,
  wordCount,
  type Budget,
} from '../reading-time';
import { formatSeconds } from '../../clock-display/clock-display';
import type { Brief, BriefCardRef, Contention } from './brief';

/** A card the brief can quote: its claim, cite and read-aloud passage. */
export type BriefEvidence = {
  readonly id: string;
  readonly title: string;
  readonly cite: string;
  readonly passage: string;
  readonly tags: readonly string[];
  /** "Mine", or the team the card is shared with. */
  readonly owner: string;
};

const p = (text: string) => `<p>${escapeHtml(text)}</p>`;

/** A card in the document: claim in bold, the cite, then the passage. */
export function evidenceHtml(card: {
  readonly title: string;
  readonly cite: string;
  readonly passage: string;
}): string {
  const passage = card.passage === '' ? '' : p(card.passage);
  return `<blockquote><p><strong>${escapeHtml(card.title)}</strong></p>${p(card.cite)}${passage}</blockquote>`;
}

const cardsHtml = (
  cards: readonly BriefCardRef[],
  passages: ReadonlyMap<string, string>,
) =>
  cards
    .map((card) =>
      evidenceHtml({ ...card, passage: passages.get(card.cardId) ?? '' }),
    )
    .join('');

const contentionHtml = (
  contention: Contention,
  number: number,
  passages: ReadonlyMap<string, string>,
) =>
  [
    `<h2>${number} · ${escapeHtml(contention.tag)}</h2>`,
    ...[contention.claim, contention.warrant, contention.impact]
      .filter((text) => text !== '')
      .map(p),
    cardsHtml(contention.cards, passages),
  ].join('');

const responsesHtml = (brief: Brief) => {
  const responses = brief.contentions.flatMap((c) => c.responses);
  if (responses.length === 0) return '';
  return `<h2>Anticipated responses</h2>${responses
    .map(
      (r) =>
        `<p><strong>They say</strong> ${escapeHtml(r.say)}</p><p><strong>We say</strong> ${escapeHtml(r.we)}</p>`,
    )
    .join('')}`;
};

/**
 * The brief as one rich-text document (ADR 0054 HTML): title, the motion
 * line, an overview, one section per contention with its cards, then the
 * anticipated responses. Card passages come from the evidence the caller
 * read, so the document holds what is read aloud.
 */
export function briefHtml(
  brief: Brief,
  evidence: readonly BriefEvidence[],
): string {
  const passages = new Map(evidence.map((card) => [card.id, card.passage]));
  const motion =
    brief.motion === '' ? '' : p(`${brief.motion} · ${sideLabel(brief.side)}`);
  const overview = [brief.framing.motion, brief.framing.burden]
    .filter((text) => text !== '')
    .map(p)
    .join('');
  const framing =
    overview === '' && brief.framing.cards.length === 0
      ? ''
      : `<h2>Overview</h2>${overview}${cardsHtml(brief.framing.cards, passages)}`;
  return [
    `<h1>${escapeHtml(brief.title)}</h1>`,
    motion,
    framing,
    ...brief.contentions.map((c, index) =>
      contentionHtml(c, index + 1, passages),
    ),
    responsesHtml(brief),
  ].join('');
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** The visible text of a stretch of document HTML. */
const textOf = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(
      /&(?:amp|lt|gt|quot|#39|nbsp);/g,
      (entity) => ENTITIES[entity] ?? entity,
    );

type OutlineSection = {
  /** Position among the document's sections (its h2 headings). */
  readonly index: number;
  readonly label: string;
  readonly cards: number;
  readonly words: number;
  readonly clock: string;
};

export type BriefOutline = {
  readonly sections: readonly OutlineSection[];
  readonly cards: number;
  readonly words: number;
  readonly clock: string;
  readonly budget: Budget;
  /** m:ss over the limit, "0:00" when it fits. */
  readonly overClock: string;
  readonly trimWords: number;
};

/**
 * The outline and reading time, read back from the document itself: each
 * h2 starts a section; the words under it (not the heading) are spoken at
 * `pace` against the rules' `limitSeconds`.
 */
export function briefOutline(
  html: string,
  pace: number,
  limitSeconds: number,
): BriefOutline {
  const [, ...parts] = html.split(/<h2[^>]*>/);
  const sections = parts.map((part, index) => {
    const end = part.indexOf('</h2>');
    const heading = end < 0 ? part : part.slice(0, end);
    const body = end < 0 ? '' : part.slice(end + 5);
    const words = wordCount(textOf(body));
    const label = textOf(heading).replace(/\s+/g, ' ').trim();
    return {
      index,
      label: label === '' ? `Section ${index + 1}` : label,
      cards: body.split('<blockquote').length - 1,
      words,
      clock: formatSeconds(readSeconds(words, pace)),
    };
  });
  const words = sections.reduce((total, s) => total + s.words, 0);
  const seconds = readSeconds(words, pace);
  const result = budget(seconds, limitSeconds);
  return {
    sections,
    cards: sections.reduce((total, s) => total + s.cards, 0),
    words,
    clock: formatSeconds(seconds),
    budget: result,
    overClock: formatSeconds(result.over ? result.deltaSeconds : 0),
    trimWords: result.over ? trimWords(result.deltaSeconds, pace) : 0,
  };
}

/** The document with one more numbered, empty section at the end. */
export function withSection(html: string, outline: BriefOutline): string {
  const numbered = outline.sections.filter((s) => /^\d/.test(s.label));
  return `${html}<h2>${numbered.length + 1} · </h2><p></p>`;
}

/** Evidence whose claim, cite, owner or tags hold every word of `query`. */
export function findEvidence(
  evidence: readonly BriefEvidence[],
  query: string,
): readonly BriefEvidence[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return evidence.filter((card) => {
    const haystack = [card.title, card.cite, card.owner, ...card.tags]
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
