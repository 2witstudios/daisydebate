import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import type { Brief, BriefCardRef, Contention } from './brief';
import { checkShareTarget } from './get-team';
import { shareNotAllowed, type Notice } from './notices';
import {
  threadSummary,
  openCount,
  type CommentThread,
  type Grant,
  type ShareRecord,
  type ShareTarget,
} from './sharing';
import { MAX_FIELD_LENGTH } from './library-query';

export type ReviewQuery = {
  readonly share: boolean;
  /** A team or @handle typed into the add row. */
  readonly add: string;
  readonly perm: string;
};

const schema = z.object({
  share: z.string().catch(''),
  add: z
    .string()
    .transform((v) => v.trim().slice(0, MAX_FIELD_LENGTH))
    .catch(''),
  perm: z.string().max(10).catch('view'),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

export function parseReviewQuery(params: SearchParams): ReviewQuery {
  const parsed = schema.parse({
    share: first(params['share']) ?? '',
    add: first(params['add']) ?? '',
    perm: first(params['perm']) ?? 'view',
  });
  return { share: parsed.share === 'open', add: parsed.add, perm: parsed.perm };
}

export const reviewHref = (id: string, share: boolean): string =>
  share ? `/prep/briefs/${id}/review?share=open` : `/prep/briefs/${id}/review`;

const uniqueCards = (brief: Brief): readonly BriefCardRef[] => {
  const all = [
    ...brief.framing.cards,
    ...brief.contentions.flatMap((c) => c.cards),
  ];
  return all.filter(
    (card, index) => all.findIndex((x) => x.cardId === card.cardId) === index,
  );
};

export type ReviewView = {
  readonly brief: Brief;
  readonly sharedLine: string;
  readonly contention: Contention | null;
  readonly evidence: readonly BriefCardRef[];
  readonly openComments: number;
  readonly threads: readonly CommentThread[];
  readonly threadSummary: string;
  readonly share: null | {
    readonly grants: readonly Grant[];
    readonly cardCount: number;
    readonly includeCards: boolean;
    readonly addName: string;
    readonly addPermission: string;
    readonly target: ShareTarget;
    readonly notice: Notice | null;
    readonly closeHref: string;
  };
  readonly shareHref: string;
  readonly editHref: string;
};

/** The brief review page's driver: a brief, who it is shared with, and the URL. */
export function reviewView(
  brief: Brief,
  record: ShareRecord,
  query: ReviewQuery,
): ReviewView {
  const closeHref = reviewHref(brief.id, false);
  const target = checkShareTarget(query.add, query.perm);
  const team = record.grants.find((g) => g.kind === 'team');
  return {
    brief,
    sharedLine:
      team === undefined ? 'Private to you' : `Shared with ${team.name}`,
    contention: brief.contentions[0] ?? null,
    evidence: brief.contentions[0]?.cards ?? [],
    openComments: openCount(record.threads),
    threads: record.threads,
    threadSummary: threadSummary(record.threads),
    share: query.share
      ? {
          grants: record.grants,
          cardCount: uniqueCards(brief).length,
          includeCards: record.includeCards,
          addName: query.add,
          addPermission: query.perm,
          target,
          notice:
            target.kind === 'not-a-member'
              ? shareNotAllowed(
                  target.teamName,
                  `${reviewHref(brief.id, true)}`,
                  closeHref,
                )
              : null,
          closeHref,
        }
      : null,
    shareHref: reviewHref(brief.id, true),
    editHref: `/prep/briefs/${brief.id}`,
  };
}
