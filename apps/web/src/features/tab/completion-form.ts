import { mapTabCommandAnswer } from './command-form-answer';
import { releaseAudiences } from '@daisy/protocol/release-audience';
import { releaseCommandEnvelopeSchema } from '@daisy/protocol/lobby/result-command';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol/primitives';
import { breakCommandEnvelopeSchema } from '@daisy/protocol/lobby/break-command';
import { resultCommandEnvelopeSchema } from '@daisy/protocol/lobby/result-command';
import { singleFormField } from '../forms/form-state';
import {
  formValues,
  refusedWith,
  unacknowledged,
  type Idle,
  type Refused,
  type Unacknowledged,
  type Moved,
} from '../forms/form-state';

export const completionContextSchema = z.strictObject({
  commandId: idSchema,
  lobbyId: idSchema,
  eventId: idSchema,
  handle: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(64),
  target: z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('open-audience'),
      thing: z.enum(['posting', 'decision', 'scores', 'reason', 'feedback']),
      audience: z.enum(releaseAudiences),
      tabRoundId: idSchema,
    }),
    z.strictObject({
      type: z.literal('announce-break'),
      resultsVersion: z.int().positive(),
    }),
    z.strictObject({
      type: z.literal('certify-event'),
      resultsVersion: z.int().positive(),
    }),
    z.strictObject({
      type: z.literal('resolve-screening-hold'),
      ballotId: idSchema,
      roundId: idSchema,
      feedbackKeys: z.array(z.string().min(1).max(128)).max(200),
    }),
  ]),
});
export type CompletionContext = z.infer<typeof completionContextSchema>;
export type CompletionFormState = Idle | Refused | Unacknowledged | Moved;

/** Rendered addressing and source guards are never taken from editable form fields. */
export function completionEnvelope(value: CompletionContext, form: FormData) {
  const context = completionContextSchema.parse(value),
    target = context.target;
  if (target.type === 'open-audience')
    return releaseCommandEnvelopeSchema.parse({
      version: 1,
      commandId: context.commandId,
      expected: {},
      command: {
        type: target.type,
        eventId: context.eventId,
        thing: target.thing,
        audience: target.audience,
        tabRounds: { kind: 'one', tabRoundId: target.tabRoundId },
      },
    });
  if (target.type === 'announce-break')
    return breakCommandEnvelopeSchema.parse({
      version: 1,
      commandId: context.commandId,
      expected: { results: target.resultsVersion },
      command: { type: target.type, eventId: context.eventId },
    });
  if (target.type === 'certify-event')
    return resultCommandEnvelopeSchema.parse({
      version: 1,
      commandId: context.commandId,
      expected: { results: target.resultsVersion },
      command: { type: target.type, eventId: context.eventId },
    });
  const mode = z
    .enum(['original', 'redacted'])
    .parse(singleFormField(form, 'mode'));
  if (mode === 'original')
    return resultCommandEnvelopeSchema.parse({
      version: 1,
      commandId: context.commandId,
      expected: {},
      command: {
        type: target.type,
        ballotId: target.ballotId,
        release: { kind: 'original' },
      },
    });
  const reason = form.has('reason') ? singleFormField(form, 'reason') : null;
  const text = {
    ...(reason === null ? {} : { reason }),
    ...(target.feedbackKeys.length
      ? {
          feedback: Object.fromEntries(
            target.feedbackKeys.map((key) => [
              key,
              singleFormField(form, `feedback:${key}`),
            ]),
          ),
        }
      : {}),
  };
  return resultCommandEnvelopeSchema.parse({
    version: 1,
    commandId: context.commandId,
    expected: {},
    command: {
      type: target.type,
      ballotId: target.ballotId,
      release: { kind: 'redacted', text },
    },
  });
}
export const completionRefused = (
  form: FormData,
  message: string,
): CompletionFormState => refusedWith(formValues(form), message);
export const completionUnacknowledged = (form: FormData): CompletionFormState =>
  unacknowledged(form);
const refusalText = (refusal: string): string => {
  switch (refusal) {
    case 'version-conflict':
      return 'Results changed. Reload and review the latest results.';
    case 'screening-pending':
      return 'Written feedback is still being screened or held. Review the ballots before certifying.';
    case 'results-incomplete':
      return 'Every published fixture needs a result first.';
    case 'break-not-configured':
      return 'Choose the break before announcing it.';
    case 'choices-pending':
      return 'Settle the remaining break choices first.';
    case 'already-announced':
      return 'The break has already been announced. Reload the standings.';
    case 'already-certified':
      return 'These results are already certified. Reload the results.';
    case 'hold-settled':
      return 'This screening hold was already resolved. Reload the ballots.';
    default:
      return 'This change could not be made. Reload and check the event.';
  }
};
export function completionAnswer(
  form: FormData,
  body: unknown,
): { readonly kind: 'accepted' } | CompletionFormState {
  return mapTabCommandAnswer(body, {
    accepted: () => ({ kind: 'accepted' as const }),
    unacknowledged: () => completionUnacknowledged(form),
    refused: (reason) => completionRefused(form, refusalText(reason)),
  });
}
