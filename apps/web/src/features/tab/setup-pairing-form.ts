import { mapTabCommandAnswer } from './command-form-answer';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { settingCommandEnvelopeSchema } from '@daisy/protocol/lobby/setting-command';
import { singleFormField } from '../forms/form-state';
import { presetLabels } from './setup-values';
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
const setupPairingContextSchema = z.strictObject({
  eventId: idSchema,
  settingsVersion: z.int().positive(),
  commandId: idSchema,
  handle: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(64),
});
export type SetupPairingContext = z.infer<typeof setupPairingContextSchema>;
export type SetupPairingState = Idle | Refused | Unacknowledged | Moved;
export const initialSetupPairing = (value: string): SetupPairingState =>
  idle({ 'pairing-preset': value });
export const setupPairingUnacknowledged = (form: FormData): SetupPairingState =>
  unacknowledged(form);
export const setupPairingRefused = (
  form: FormData,
  error: string,
): SetupPairingState =>
  refusedWith({ 'pairing-preset': field(form, 'pairing-preset') }, error);
/** Every bound identity/guard is revalidated, while the displayed version is never refreshed on POST. */
export const setupPairingEnvelope = (
  untrusted: SetupPairingContext,
  form: FormData,
) => {
  const context = setupPairingContextSchema.parse(untrusted);
  const label = singleFormField(form, 'pairing-preset');
  const preset = Object.entries(presetLabels).find(
    ([, words]) => words === label,
  )?.[0];
  return settingCommandEnvelopeSchema.parse({
    version: 1,
    commandId: context.commandId,
    expected: { settings: context.settingsVersion },
    command: {
      type: 'set-setting',
      scope: { kind: 'event', id: context.eventId },
      key: 'pairing.preset',
      value: { value: preset },
      hold: 'default',
    },
  });
};
export const setupPairingAnswer = (
  form: FormData,
  body: unknown,
): { readonly kind: 'accepted' } | SetupPairingState => {
  return mapTabCommandAnswer(body, {
    accepted: () => ({ kind: 'accepted' as const }),
    unacknowledged: () => setupPairingUnacknowledged(form),
    refused: (reason) =>
      setupPairingRefused(
        form,
        reason === 'version-conflict'
          ? 'Setup changed. Reload this page before trying again.'
          : reason === 'setting-enforced'
            ? 'An inherited setting is enforced. Reload this page.'
            : 'This pairing change could not be made. Reload this page.',
      ),
  });
};
