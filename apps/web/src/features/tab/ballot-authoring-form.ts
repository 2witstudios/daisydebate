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
import { idSchema } from '@daisy/protocol';
import { lobbySetupCommandEnvelopeSchema } from '@daisy/protocol/lobby/lobby-setup-command';
import { settingCommandEnvelopeSchema } from '@daisy/protocol/lobby/setting-command';
import { singleFormField } from '../../server/form-field';
import { ballotBodyFromForm } from './ballot-body-form';

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
