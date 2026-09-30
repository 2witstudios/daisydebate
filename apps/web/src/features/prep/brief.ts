import type { Side, Visibility } from './library-item';
import {
  budget,
  formatClock,
  readSeconds,
  trimWords,
  wordCount,
  type Budget,
} from './reading-time';

export type BriefCardRef = {
  readonly cardId: string;
  readonly title: string;
  readonly cite: string;
  /** Words of the card's read-aloud passage. */
  readonly words: number;
};

export type BriefResponse = { readonly say: string; readonly we: string };

export type Contention = {
  readonly id: string;
  readonly tag: string;
  readonly claim: string;
  readonly warrant: string;
  readonly impact: string;
  readonly cards: readonly BriefCardRef[];
  readonly responses: readonly BriefResponse[];
};

export type Brief = {
  readonly id: string;
  readonly title: string;
  readonly side: Side;
  readonly motion: string;
  readonly visibility: Visibility;
  /** When it was last saved, as shown ("12:04"); empty for a new brief. */
  readonly savedAt: string;
  readonly framing: {
    readonly motion: string;
    readonly burden: string;
    readonly cards: readonly BriefCardRef[];
  };
  readonly contentions: readonly Contention[];
};

const cardWords = (cards: readonly BriefCardRef[]): number =>
  cards.reduce((total, card) => total + card.words, 0);

export const framingWords = (brief: Brief): number =>
  wordCount(brief.framing.burden) + cardWords(brief.framing.cards);

/** Spoken words of a contention: claim, warrant, impact and its cards. */
export const contentionWords = (contention: Contention): number =>
  wordCount(contention.claim) +
  wordCount(contention.warrant) +
  wordCount(contention.impact) +
  cardWords(contention.cards);

export const responseCount = (brief: Brief): number =>
  brief.contentions.reduce((total, c) => total + c.responses.length, 0);

type SectionTime = {
  readonly label: string;
  readonly words: number;
  readonly seconds: number;
  readonly clock: string;
};

export type BriefTime = {
  readonly sections: readonly SectionTime[];
  readonly whole: SectionTime;
  readonly budget: Budget;
  readonly overClock: string;
  readonly trimWords: number;
};

/**
 * Reading time of the brief against a speech limit the debate rules supply
 * (a sample constant in the mock layer): per section and as one speech.
 */
export function briefTime(
  brief: Brief,
  pace: number,
  limitSeconds: number,
): BriefTime {
  const section = (label: string, words: number): SectionTime => {
    const seconds = readSeconds(words, pace);
    return { label, words, seconds, clock: formatClock(seconds) };
  };
  const sections = [
    section('Framing', framingWords(brief)),
    ...brief.contentions.map((c, index) =>
      section(`Contention ${index + 1}`, contentionWords(c)),
    ),
  ];
  const words = sections.reduce((total, s) => total + s.words, 0);
  const whole = section('Whole brief', words);
  const result = budget(whole.seconds, limitSeconds);
  return {
    sections,
    whole,
    budget: result,
    overClock: formatClock(result.over ? result.deltaSeconds : 0),
    trimWords: result.over ? trimWords(result.deltaSeconds, pace) : 0,
  };
}
