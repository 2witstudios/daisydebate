import { assert, setupRitewayBun, test } from 'riteway/bun';
import { formFields } from '../forms/form-state';
import {
  setupPairingAnswer,
  setupPairingEnvelope,
  setupPairingRefused,
  setupPairingUnacknowledged,
} from './setup-pairing-form';
setupRitewayBun();
const context = {
  eventId: 'e'.repeat(24),
  commandId: 'c'.repeat(24),
  settingsVersion: 7,
  handle: 'a-real-tournament',
};
const form = () => {
  const body = new FormData();
  body.set('pairing-preset', 'Round robin');
  return body;
};
test('an unacknowledged pairing post retains its original command and refuses an obsolete view', () => {
  const original = setupPairingEnvelope(context, form());
  const lost = setupPairingUnacknowledged(form());
  const retry = new FormData();
  for (const [key, value] of Object.entries(formFields(lost).values))
    retry.set(key, value);
  assert({
    given: 'a pairing response lost after it might have committed',
    should:
      'retain the original selection, command identity and displayed settings guard for replay',
    actual: [lost.kind, setupPairingEnvelope(context, retry)],
    expected: ['unacknowledged', original],
  });
  assert({
    given: 'an authoritative stale-guard refusal',
    should: 'retain the chosen preset and require a reload',
    actual: setupPairingAnswer(form(), {
      kind: 'refused',
      refusal: 'version-conflict',
    }),
    expected: {
      kind: 'refused',
      values: { 'pairing-preset': 'Round robin' },
      error: 'Setup changed. Reload this page before trying again.',
    },
  });
  assert({
    given: 'an unreadable success response',
    should:
      'keep the same retryable state instead of claiming refusal or success',
    actual: setupPairingAnswer(form(), { kind: 'accepted' }),
    expected: lost,
  });
});
test('duplicate or invented preset fields cannot become a command', () => {
  const duplicate = form();
  duplicate.append('pairing-preset', 'Random');
  const unknown = form();
  unknown.set('pairing-preset', 'constructor');
  const valid = (body: FormData) => {
    try {
      setupPairingEnvelope(context, body);
      return true;
    } catch {
      return false;
    }
  };
  assert({
    given: 'a duplicate choice, unknown choice or forged bound version',
    should:
      'fail validation while a refusal can still retain the first text field safely',
    actual: [
      valid(duplicate),
      valid(unknown),
      (() => {
        try {
          setupPairingEnvelope({ ...context, settingsVersion: -1 }, form());
          return true;
        } catch {
          return false;
        }
      })(),
      setupPairingRefused(duplicate, 'Choose a preset.'),
    ],
    expected: [
      false,
      false,
      false,
      {
        kind: 'refused',
        values: { 'pairing-preset': 'Round robin' },
        error: 'Choose a preset.',
      },
    ],
  });
});
