import { mapTabCommandAnswer } from './command-form-answer';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { settingCommandEnvelopeSchema } from '@daisy/protocol/lobby/setting-command';
import { singleFormField } from '../forms/form-state';
import {
  field,
  idle,
  refusedWith,
  unacknowledged,
  type Idle,
  type Refused,
  type Unacknowledged,
  type Moved,
} from '../forms/form-state';
const judgeObligationContextSchema = z.strictObject({
  eventId: idSchema,
  settingsVersion: z.int().positive(),
  commandId: idSchema,
  handle: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(64),
});
export type JudgeObligationContext = z.infer<
  typeof judgeObligationContextSchema
>;
export type JudgeObligationState = Idle | Refused | Unacknowledged | Moved;
export const initialJudgeObligation = (
  value: string,
  judges: string,
): JudgeObligationState =>
  idle({ 'entries-per-judge': value, 'judges-per-group': judges });
export const judgeObligationUnacknowledged = (
  form: FormData,
): JudgeObligationState => unacknowledged(form);
export const judgeObligationRefused = (
  form: FormData,
  error: string,
): JudgeObligationState =>
  refusedWith(
    {
      'entries-per-judge': field(form, 'entries-per-judge'),
      'judges-per-group': field(form, 'judges-per-group'),
    },
    error,
  );
/** Every bound identity/guard is revalidated, while the displayed version is never refreshed on POST. */
export const judgeObligationEnvelope = (
  untrusted: JudgeObligationContext,
  form: FormData,
) => {
  const context = judgeObligationContextSchema.parse(untrusted);
  const entries = singleFormField(form, 'entries-per-judge');
  const judges = singleFormField(form, 'judges-per-group');
  return settingCommandEnvelopeSchema.parse({
    version: 1,
    commandId: context.commandId,
    expected: { settings: context.settingsVersion },
    command: {
      type: 'set-setting',
      scope: { kind: 'event', id: context.eventId },
      key: 'entry.judge_obligation',
      value: {
        kind: 'ratio',
        entriesPerJudge: entries.match(/^[1-9][0-9]*$/)
          ? Number(entries)
          : null,
        judgesPerGroup: judges.match(/^(0|[1-9][0-9]*)$/)
          ? Number(judges)
          : null,
      },
      hold: 'default',
    },
  });
};
export const judgeObligationAnswer = (
  form: FormData,
  body: unknown,
): { readonly kind: 'accepted' } | JudgeObligationState => {
  return mapTabCommandAnswer(body, {
    accepted: () => ({ kind: 'accepted' as const }),
    unacknowledged: () => judgeObligationUnacknowledged(form),
    refused: (reason) =>
      judgeObligationRefused(
        form,
        reason === 'version-conflict'
          ? 'Entries policy changed. Reload this page before trying again.'
          : reason === 'setting-enforced'
            ? 'An inherited setting is enforced. Reload this page.'
            : 'This judge obligation change could not be made. Reload this page.',
      ),
  });
};
