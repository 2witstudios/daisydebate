import type { ReleaseFlagKey } from '../flags/catalogue';

/**
 * The three homes of public reading: Guides help someone use
 * Daisy, Learn helps them get better at debate, and Stories carries what is
 * new. A Guide and a Learn article link each other where a task calls for it.
 */
export const homes = ['guides', 'learn', 'stories'] as const;
export type Home = (typeof homes)[number];

/**
 * Copy written with links: `[label](/path)` links to an app path or another
 * article, and everything else is plain text.
 */
export type Prose = string;

/** One piece of an article, in reading order. */
export type Block =
  | { readonly kind: 'paragraph'; readonly text: Prose }
  | { readonly kind: 'heading'; readonly id: string; readonly text: string }
  | { readonly kind: 'steps'; readonly items: readonly Prose[] }
  | { readonly kind: 'list'; readonly items: readonly Prose[] }
  | {
      readonly kind: 'terms';
      readonly items: readonly {
        readonly term: string;
        readonly detail: Prose;
      }[];
    }
  | { readonly kind: 'note'; readonly text: Prose }
  | {
      readonly kind: 'example';
      readonly label: string;
      readonly text: string;
    };

/** A group of articles in one home, such as Judging in Guides. */
export type Collection = {
  readonly home: Home;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  /** Shown only where this release is open, like the feature it explains. */
  readonly release?: ReleaseFlagKey;
};

/** `home/collection/slug`: how one article names another. */
export type ArticleRef = `${Home}/${string}/${string}`;

export type Article = {
  readonly home: Home;
  readonly collection: string;
  readonly slug: string;
  readonly title: string;
  /** One sentence: the article's lede and its card. */
  readonly summary: string;
  /** The day its facts were last checked against the code (YYYY-MM-DD). */
  readonly updated: string;
  readonly blocks: readonly Block[];
  readonly related: readonly ArticleRef[];
  /**
   * The repository files its product claims were checked against. A Learn
   * article that makes no product claims has none.
   */
  readonly sources: readonly string[];
  readonly release?: ReleaseFlagKey;
};
