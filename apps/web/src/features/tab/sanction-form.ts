import { mapTabCommandAnswer } from './command-form-answer';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol/primitives';
import { sanctionCommandEnvelopeSchema } from '@daisy/protocol/lobby/sanction-command';
import {
  done,
  idle,
  refused,
  unacknowledged,
  type Done,
  type Idle,
  type Refused,
  type Unacknowledged,
} from '../forms/form-state';
const sanctionFormContextSchema = z.strictObject({
  organizationId: idSchema,
  lobbyId: idSchema,
  sanctionId: idSchema,
  commandId: idSchema,
  version: z.int().positive(),
  decision: z.enum(['approve-sanction', 'decline-sanction']),
  handle: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(64),
});
export type SanctionFormContext = z.infer<typeof sanctionFormContextSchema>;
export type SanctionFormState = Idle | Refused | Unacknowledged | Done;
export const initialSanctionForm: SanctionFormState = idle();
export const sanctionFormUnavailable = (form: FormData): SanctionFormState =>
  unacknowledged(form);
/** Bound ids and displayed versions round-trip through the browser and are never trusted. */
export const sanctionFormBody = (input: SanctionFormContext) => {
  const context = sanctionFormContextSchema.parse(input);
  return {
    organizationId: context.organizationId,
    lobbyId: context.lobbyId,
    envelope: sanctionCommandEnvelopeSchema.parse({
      version: 1,
      commandId: context.commandId,
      expected: { sanction: context.version },
      command: { type: context.decision, sanctionId: context.sanctionId },
    }),
  };
};
export const sanctionFormAnswer = (
  form: FormData,
  body: unknown,
): SanctionFormState => {
  return mapTabCommandAnswer(body, {
    accepted: done,
    unacknowledged: () => unacknowledged(form),
    refused: (reason) =>
      refused(
        form,
        reason === 'version-conflict'
          ? 'This request changed. Reload before deciding.'
          : reason === 'template-mismatch'
            ? 'This event no longer meets the template. Reload to check the request.'
            : 'This request could not be decided. Reload to check its status.',
      ),
  });
};
