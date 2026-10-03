import type { JudgeResource } from './resources';

/**
 * What a judging resource's button does. The guides, annotated examples and
 * practice debates have no backend yet, so each button answers on the same
 * page with the shell banner, worded by the resource's own call to action.
 * The real destinations replace this function and nothing else.
 */
export type ResourceAction = {
  readonly kind: 'sample';
  readonly label: string;
};

export const resourceAction = (resource: JudgeResource): ResourceAction => ({
  kind: 'sample',
  label: resource.cta,
});
