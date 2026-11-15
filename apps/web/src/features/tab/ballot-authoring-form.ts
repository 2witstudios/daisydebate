import { lobbyCommandReceiptSchema } from '@daisy/protocol/lobby/command';
import {
  refusedWith,
  formValues,
  unacknowledged,
  type Idle,
  type Refused,
  type Unacknowledged,
  type Moved,
} from '../forms/form-state';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import {
  ballotDefinitionBodySchema,
  idSchema,
  type BallotDefinitionBody,
} from '@daisy/protocol';
import { lobbySetupCommandEnvelopeSchema } from '@daisy/protocol/lobby/lobby-setup-command';
import { settingCommandEnvelopeSchema } from '@daisy/protocol/lobby/setting-command';
import { singleFormField } from '../../server/form-field';

export const ballotAuthoringContextSchema = z.strictObject({
  lobbyId: idSchema,
  eventId: idSchema,
  commandId: idSchema,
  lobbyVersion: z.int().positive(),
  settingsVersion: z.int().positive(),
  eventName: z.string().min(1),
  eventLabel: z.string().nullable(),
  handle: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(64),
});
export type BallotAuthoringContext = z.infer<
  typeof ballotAuthoringContextSchema
>;
const numberField = (form: FormData, name: string): number => {
  const value = singleFormField(form, name).trim();
  if (value === '') throw createAppError('VALIDATION');
  return z.number().finite().parse(Number(value));
};
const countField = (form: FormData, name: string, maximum: number): number =>
  z.int().min(1).max(maximum).parse(numberField(form, name));
const checked = (form: FormData, name: string): boolean => {
  if (!form.has(name)) return false;
  return z.literal('on').parse(singleFormField(form, name)) === 'on';
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
export const publishBallotEnvelope = (
  untrusted: BallotAuthoringContext,
  form: FormData,
) => {
  const context = ballotAuthoringContextSchema.parse(untrusted);
  const target = singleFormField(form, 'publish-target');
  return lobbySetupCommandEnvelopeSchema.parse({
    version: 1,
    commandId: context.commandId,
    expected: { lobby: context.lobbyVersion },
    command: {
      type: 'define-ballot',
      lobbyId: context.lobbyId,
      ballotDefinition:
        target === 'new'
          ? { kind: 'new', name: singleFormField(form, 'definition-name') }
          : { kind: 'revision', ballotDefinitionId: idSchema.parse(target) },
      settings: ballotBodyFromForm(form),
    },
  });
};
export const pinBallotEnvelope = (
  untrusted: BallotAuthoringContext,
  form: FormData,
) => {
  const context = ballotAuthoringContextSchema.parse(untrusted);
  const pin = singleFormField(form, 'ballot-version');
  const [id, version, extra] = pin.split('@');
  if (pin !== 'daisy' && (extra !== undefined || !id || !version))
    throw createAppError('VALIDATION');
  return lobbySetupCommandEnvelopeSchema.parse({
    version: 1,
    commandId: context.commandId,
    expected: { lobby: context.lobbyVersion },
    command: {
      type: 'update-event',
      lobbyId: context.lobbyId,
      eventId: context.eventId,
      name: context.eventName,
      label: context.eventLabel,
      ballotDefinition:
        pin === 'daisy' ? null : { id, version: Number(version) },
    },
  });
};
export const screeningBallotEnvelope = (
  untrusted: BallotAuthoringContext,
  form: FormData,
) => {
  const context = ballotAuthoringContextSchema.parse(untrusted);
  return settingCommandEnvelopeSchema.parse({
    version: 1,
    commandId: context.commandId,
    expected: { settings: context.settingsVersion },
    command: {
      type: 'set-setting',
      scope: { kind: 'event', id: context.eventId },
      key: 'ballot.screening',
      value: { value: singleFormField(form, 'screening') },
      hold: 'default',
    },
  });
};

export type BallotAuthoringMode = 'publish' | 'pin' | 'screening';

export type BallotAuthoringState = Idle | Refused | Unacknowledged | Moved;
export const ballotAuthoringRefused = (
  form: FormData,
  error: string,
): BallotAuthoringState => refusedWith(formValues(form), error);
export const ballotAuthoringUnacknowledged = (
  form: FormData,
): BallotAuthoringState => unacknowledged(form);
const answerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepted'), receipt: lobbyCommandReceiptSchema }),
  z.object({ kind: z.literal('refused'), refusal: z.string() }),
]);
export const ballotAuthoringAnswer = (
  form: FormData,
  body: unknown,
): { readonly kind: 'accepted' } | BallotAuthoringState => {
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return ballotAuthoringUnacknowledged(form);
  if (parsed.data.kind === 'accepted') return { kind: 'accepted' };
  return ballotAuthoringRefused(
    form,
    parsed.data.refusal === 'version-conflict'
      ? 'This event changed. Reload before trying again.'
      : parsed.data.refusal === 'entries-exist'
        ? 'Entries already use this event. Its ballot cannot change.'
        : parsed.data.refusal === 'template-pinned'
          ? 'This event follows a template. Its ballot is pinned by that template.'
          : 'This change could not be made. Check the ballot and reload the event.',
  );
};
