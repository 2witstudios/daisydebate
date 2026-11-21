import { mapTabCommandAnswer } from './command-form-answer';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import {
  drawCommandEnvelopeSchema,
  drawOverrideSchema,
} from '@daisy/protocol/lobby/draw-command';
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
export const drawFormContextSchema = z.strictObject({
  handle: z.string().min(1).max(80),
  lobbyId: idSchema,
  eventId: idSchema,
  tabRoundId: idSchema,
  envelope: drawCommandEnvelopeSchema,
  overrideKeys: z.array(drawOverrideSchema.shape.key),
});
export type DrawFormContext = z.infer<typeof drawFormContextSchema>;
export type DrawFormState = Idle | Refused | Unacknowledged | Moved;
/** Targets, source guards, entropy and replay identity are bound by the rendered server action. */
export function drawFormEnvelope(value: DrawFormContext, form: FormData) {
  const context = drawFormContextSchema.parse(value),
    envelope = context.envelope;
  if (envelope.command.type !== 'publish-draw') return envelope;
  return drawCommandEnvelopeSchema.parse({
    ...envelope,
    command: {
      ...envelope.command,
      overrides: context.overrideKeys.map((key) => ({
        key,
        reason: singleFormField(form, `override:${key}`),
      })),
    },
  });
}
export const drawFormRefused = (
  form: FormData,
  message: string,
): DrawFormState => refusedWith(formValues(form), message);
export const drawFormUnacknowledged = (form: FormData): DrawFormState =>
  unacknowledged(form);
const refusalCopy: Readonly<Record<string, string>> = {
  'version-conflict':
    'The draw or its inputs changed. Reload and review the current draw.',
  'inputs-changed': 'The inputs changed. Reload and draw again.',
  'judges-insufficient':
    'There are not enough available, eligible judges for this draw.',
  'rule-broken':
    'Every broken rule needs an explicit reason before publication.',
  'rule-unsatisfiable':
    'No draw satisfies the current rules. Review the event settings.',
  'results-incomplete':
    'Record the required results before drawing this round.',
  'choices-pending': 'Settle the break choices before drawing this round.',
  'slot-unset': 'Choose this round’s time slot before publication.',
  'fixture-started':
    'A fixture has started and its pairing can no longer change.',
};
export function drawFormAnswer(
  form: FormData,
  body: unknown,
): { readonly kind: 'accepted' } | DrawFormState {
  return mapTabCommandAnswer(body, {
    accepted: () => ({ kind: 'accepted' as const }),
    unacknowledged: () => drawFormUnacknowledged(form),
    refused: (reason) =>
      drawFormRefused(
        form,
        refusalCopy[reason] ??
          'This draw change was refused. Reload and review the current draw.',
      ),
    pending: {
      contract: 'draw',
      answer: () =>
        drawFormRefused(
          form,
          'This change is awaiting confirmation by another authorized person.',
        ),
    },
  });
}
