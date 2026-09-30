import type { JudgeResource } from './resources';

/**
 * What a judging resource's button does. The guides, annotated examples and
 * practice debates do not exist yet, so each button is inert and says why.
 * The real destinations replace this function and nothing else.
 */
export type ResourceAction = {
  readonly kind: 'inert';
  readonly reason: string;
};

export const resourceAction = (resource: JudgeResource): ResourceAction => ({
  kind: 'inert',
  reason: resource.neededToQualify
    ? 'Practice debates are not recorded yet.'
    : 'This guide is not written yet.',
});
