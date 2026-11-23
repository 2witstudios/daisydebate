/**
 * Where the product links into the guides. Plain strings, so a client page
 * can import them without the library; the article graph test fails when
 * one no longer names a collection or article.
 */
export const guideEntryLinks = {
  judging: '/guides/judging',
  understandingABallot: '/guides/judging/understanding-a-ballot',
} as const;
