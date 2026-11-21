import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import {
  ballotDefinitionBodySchema,
  type BallotDefinitionBody,
} from '@daisy/protocol';
import { singleFormField } from '../forms/form-state';

/*
 * The publish form's fields read into a ballot definition body. The publish
 * action and the editor's live preview both read the form with this, so it
 * carries nothing of the command envelopes and is safe in a client bundle.
 */
const numberField = (form: FormData, name: string): number => {
  const value = singleFormField(form, name).trim();
  if (value === '') throw createAppError('VALIDATION');
  return z.number().finite().parse(Number(value));
};
const countField = (form: FormData, name: string, maximum: number): number =>
  z.int().min(1).max(maximum).parse(numberField(form, name));
const checked = (form: FormData, name: string): boolean => {
  if (!form.has(name)) return false;
  // A checkbox sends only its own value; anything else is refused.
  z.literal('on').parse(singleFormField(form, name));
  return true;
};
const written = (form: FormData, key: 'reason' | 'feedback') => {
  const rule = z
    .enum(['required', 'optional', 'off'])
    .parse(singleFormField(form, `${key}-rule`));
  return rule === 'off'
    ? null
    : { required: rule === 'required', max: numberField(form, `${key}-max`) };
};
/** Every authored default, identity, reward, anchor and weight comes from a visible field. */
export const ballotBodyFromForm = (form: FormData): BallotDefinitionBody => {
  if (form.has('privateNote'))
    throw createAppError('VALIDATION', 'Private notes are unavailable');
  const kind = z
    .enum(['winner', 'ranking-sides', 'ranking-speakers'])
    .parse(singleFormField(form, 'decision'));
  const per = z
    .enum(['none', 'side', 'seat', 'speech'])
    .parse(singleFormField(form, 'score-subject'));
  const criteriaKind =
    per === 'none'
      ? 'holistic'
      : z
          .enum(['holistic', 'grid'])
          .parse(singleFormField(form, 'criteria-kind'));
  const groups =
    criteriaKind === 'grid'
      ? Array.from(
          { length: countField(form, 'group-count', 10) },
          (_, group) => ({
            id: singleFormField(form, `group-${group}-id`),
            name: singleFormField(form, `group-${group}-name`),
            categories: Array.from(
              { length: countField(form, `group-${group}-count`, 20) },
              (_, category) => {
                const key = `group-${group}-criterion-${category}`;
                return {
                  id: singleFormField(form, `${key}-id`),
                  name: singleFormField(form, `${key}-name`),
                  rewards: singleFormField(form, `${key}-rewards`),
                  anchors: singleFormField(form, `${key}-anchors`)
                    .split('\n')
                    .map((anchor) => anchor.trim())
                    .filter(Boolean),
                };
              },
            ),
          }),
        )
      : [];
  const weights =
    per === 'speech'
      ? Array.from(
          {
            length: z
              .int()
              .min(0)
              .max(64)
              .parse(numberField(form, 'weight-count')),
          },
          (_, index) => ({
            key: singleFormField(form, `weight-${index}-key`),
            value: numberField(form, `weight-${index}-value`),
          }),
        )
      : [];
  if (new Set(weights.map((weight) => weight.key)).size !== weights.length)
    throw createAppError('VALIDATION');
  return ballotDefinitionBodySchema.parse({
    decision:
      kind === 'winner'
        ? {
            kind,
            lowPointWin: checked(form, 'low-point-win'),
            tie: checked(form, 'ties'),
            doubleLoss: checked(form, 'double-loss'),
          }
        : {
            kind: 'ranking',
            of: kind === 'ranking-sides' ? 'sides' : 'speakers',
            ties: checked(form, 'ties'),
          },
    points:
      per === 'none'
        ? null
        : {
            per,
            scale: {
              min: numberField(form, 'score-min'),
              max: numberField(form, 'score-max'),
              step: numberField(form, 'score-step'),
            },
            default: numberField(form, 'score-default'),
            criteria:
              criteriaKind === 'grid'
                ? { kind: criteriaKind, groups }
                : { kind: criteriaKind },
            weights:
              per === 'speech' && weights.length
                ? Object.fromEntries(
                    weights.map((weight) => [weight.key, weight.value]),
                  )
                : null,
          },
    speakerRanks: checked(form, 'speaker-ranks'),
    written: {
      reason: written(form, 'reason'),
      feedback: written(form, 'feedback'),
    },
  });
};
