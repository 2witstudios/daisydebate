import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { analyticsView, readStoredConsent } from './viewer-analytics';
import type { Consent } from './consent';

setupRitewayBun();

const consent = (analytics: string) =>
  ({
    version: 1,
    necessary: 'granted',
    analytics,
    replay: 'unanswered',
  }) as Consent;
const member = {
  state: 'member',
  username: 'ada',
  principal: { kind: 'user', userId: 'user1', actorId: 'actor1' },
} as never;
const config = {
  key: 'key',
  host: 'https://h.example',
  available: { analytics: true, replay: false },
};
const refused = () =>
  Promise.reject(new Error('driver', { cause: refuseCapacity() }));

test('a stored consent read reports a refusal apart from an answer', async () => {
  const stored = consent('granted');
  assert({
    given: 'a read that finds a choice, finds none, and is refused',
    should: 'answer each, and carry no consent for the refusal',
    actual: [
      await readStoredConsent(async () => stored, 'user1'),
      await readStoredConsent(async () => null, 'user1'),
      await readStoredConsent(refused, 'user1'),
    ],
    expected: [
      { kind: 'found', stored },
      { kind: 'found', stored: null },
      { kind: 'refused' },
    ],
  });
  await assertRejects({
    given: 'a read refused by a lane that can never admit it',
    should: 'keep failing, because asking again cannot help',
    actual: () =>
      readStoredConsent(
        () =>
          Promise.reject(
            refuseCapacity({ lane: 'control', reason: 'unconfigured' }),
          ),
        'user1',
      ),
    code: 'INFRASTRUCTURE',
  });
  await assertRejects({
    given: 'a read that really fails',
    should: 'keep failing',
    actual: () =>
      readStoredConsent(
        () => Promise.reject(createAppError('INTERNAL')),
        'user1',
      ),
    code: 'INTERNAL',
  });
});

test('a refused read turns analytics off, adopts nothing and invents no choice', () => {
  const cookie = consent('granted');
  const view = (read: Parameters<typeof analyticsView>[0]['read']) =>
    analyticsView({ config, identity: member, cookie, read });
  const pick = ({
    keyValue,
    needsAdoption,
    consentUnreadable,
  }: ReturnType<typeof view>) => ({
    keyValue,
    needsAdoption,
    consentUnreadable,
  });
  assert({
    given:
      'a member whose stored choice matches, differs, or could not be read',
    should:
      'adopt only a real difference, and mark only the refusal unreadable',
    actual: [
      pick(view({ kind: 'found', stored: cookie })),
      pick(view({ kind: 'found', stored: consent('denied') })),
      pick(view({ kind: 'refused' })),
    ],
    expected: [
      { keyValue: 'key', needsAdoption: false, consentUnreadable: false },
      { keyValue: 'key', needsAdoption: true, consentUnreadable: false },
      { keyValue: null, needsAdoption: false, consentUnreadable: true },
    ],
  });
});
