import type { PrepSource } from '../source';
import type { BriefEvidence } from './brief-document';

/**
 * The evidence seam for the brief editor's margin: every card the owner can
 * quote, theirs and their teams'. `now` is injected; the backend
 * read replaces this function and nothing else.
 */
export const listBriefEvidence = (
  source: PrepSource,
  now: string,
): readonly BriefEvidence[] =>
  source.library(now).flatMap((item) =>
    item.kind === 'card'
      ? [
          {
            id: item.id,
            title: item.title,
            cite: `${item.author}, ${item.publication}, ${item.year}`,
            passage: item.passage,
            tags: item.tags,
            owner:
              item.visibility.kind === 'team'
                ? item.visibility.teamName
                : 'Mine',
          },
        ]
      : [],
  );
