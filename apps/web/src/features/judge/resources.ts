export type ResourceKind =
  'guide' | 'criteria' | 'examples' | 'conflicts' | 'practice' | 'rating';

/**
 * A judging resource card. Content is sample copy: the guides, examples and
 * practice debates are not written or recorded yet.
 */
export type JudgeResource = {
  readonly kind: ResourceKind;
  readonly title: string;
  readonly blurb: string;
  /** Reading time or item count, in the card's own words. */
  readonly meta: string;
  readonly cta: string;
  /** True for the one step a new judge must complete to qualify. */
  readonly neededToQualify: boolean;
  /** Shown as a row in the hub's short list. */
  readonly onHub: boolean;
};

/** The resources the hub lists; the full page lists them all. */
export const hubResources = (
  resources: readonly JudgeResource[],
): readonly JudgeResource[] => resources.filter(({ onHub }) => onHub);
