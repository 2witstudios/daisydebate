import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { drillHref } from './plan';
import { trainDestinations } from './actions';
import {
  parseHubQuery,
  withDone,
  withPlanContext,
  type HubQuery,
} from './query';

/** A saved argument, as reviewed: the claim is the cue, the rest is recalled. */
export type ReviewCard = {
  readonly id: string;
  readonly motion: string;
  readonly claim: string;
  readonly warrant: string;
  readonly impact: string;
};

const ratingIds = ['again', 'hard', 'good', 'easy'] as const;
type RatingId = (typeof ratingIds)[number];

/** Sample schedule: the real intervals come from the review scheduler. */
const ratings: readonly { id: RatingId; label: string; when: string }[] = [
  { id: 'again', label: 'Again', when: '10 minutes' },
  { id: 'hard', label: 'Hard', when: '2 days' },
  { id: 'good', label: 'Good', when: '4 days' },
  { id: 'easy', label: 'Easy', when: '9 days' },
];

/** The review's URL state: which card, whether it is revealed, the last rating. */
export type ReviewQuery = {
  /** The card's position in today's queue, from 1. */
  readonly card: number;
  readonly reveal: boolean;
  readonly last: RatingId | null;
  readonly plan: HubQuery;
};

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

export function parseReviewQuery(params: SearchParams): ReviewQuery {
  return {
    card: z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .catch(1)
      .parse(first(params['card'])),
    reveal: first(params['reveal']) === '1',
    last: z.enum(ratingIds).nullable().catch(null).parse(first(params['last'])),
    plan: parseHubQuery(params),
  };
}

const reviewHref = (
  query: ReviewQuery,
  next: { card: number; reveal?: boolean; last?: RatingId | null },
): string => {
  const params = new URLSearchParams();
  if (next.card !== 1) params.set('card', String(next.card));
  if (next.reveal === true) params.set('reveal', '1');
  if (next.last) params.set('last', next.last);
  const search = params.toString();
  return withPlanContext(
    search === ''
      ? trainDestinations.review
      : `${trainDestinations.review}?${search}`,
    query.plan,
  );
};

type QueueRow = {
  readonly label: string;
  readonly state: 'done' | 'current' | 'todo';
};

type Library = {
  readonly total: number;
  readonly dueTomorrow: number;
};

type Common = {
  readonly queue: readonly QueueRow[];
  readonly left: number;
  readonly libraryTotal: number;
  readonly backHref: string;
  readonly drillHref: string;
};

export type ReviewView = Common &
  (
    | {
        readonly kind: 'empty';
      }
    | {
        readonly kind: 'card';
        readonly position: number;
        readonly count: number;
        readonly progress: number;
        readonly card: ReviewCard;
        readonly revealed: boolean;
        readonly lastLine: string | null;
        readonly revealHref: string;
        readonly rate: readonly {
          readonly label: string;
          readonly when: string;
          readonly href: string;
        }[];
        readonly editHref: string;
      }
    | {
        readonly kind: 'done';
        readonly reviewed: number;
        readonly nextLine: string;
      }
  );

const rows = (cards: readonly ReviewCard[], at: number): readonly QueueRow[] =>
  cards.map((card, index) => ({
    label: card.claim,
    state: index + 1 < at ? 'done' : index + 1 === at ? 'current' : 'todo',
  }));

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

/** The review screen: a card to recall, its answer, or caught up. */
export function reviewView(
  cards: readonly ReviewCard[],
  query: ReviewQuery,
  library: Library,
): ReviewView {
  const common = {
    queue: rows(cards, query.card),
    left: Math.max(cards.length - (query.card - 1), 0),
    libraryTotal: library.total,
    drillHref: withPlanContext(drillHref('impact'), query.plan),
    backHref: withPlanContext(
      trainDestinations.hub,
      query.card > cards.length ? withDone(query.plan, 'review') : query.plan,
    ),
  };
  if (library.total === 0) return { ...common, kind: 'empty' };
  const card = cards[query.card - 1];
  if (card === undefined)
    return {
      ...common,
      kind: 'done',
      reviewed: cards.length,
      nextLine: `Next review: tomorrow, ${plural(library.dueTomorrow, 'argument')}.`,
    };
  const last = ratings.find((rating) => rating.id === query.last);
  return {
    ...common,
    kind: 'card',
    position: query.card,
    count: cards.length,
    progress: Math.round(((query.card - 1) / cards.length) * 100),
    card,
    revealed: query.reveal,
    lastLine: last ? `${last.label}: back in ${last.when}` : null,
    revealHref: reviewHref(query, {
      card: query.card,
      reveal: true,
      last: query.last,
    }),
    rate: ratings.map((rating) => ({
      label: rating.label,
      when: rating.when,
      href: reviewHref(query, { card: query.card + 1, last: rating.id }),
    })),
    editHref: withPlanContext(drillHref('impact'), query.plan),
  };
}
