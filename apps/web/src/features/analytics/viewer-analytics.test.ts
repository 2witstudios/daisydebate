import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import {
  analyticsView,
  readStoredConsent,
  readViewerAnalytics,
  type StoredConsentRead,
} from './viewer-analytics';
import type { Identity } from '@daisy/auth';
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
} as Identity;
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

const cookie = consent('granted');
const { available } = config;
const unreadable = { available, choice: { kind: 'unreadable' }, capture: null };
const capture = (over: object) => ({
  keyValue: 'key',
  host: config.host,
  userId: 'user1',
  needsAdoption: false,
  ...over,
});
const signedIn = (read: StoredConsentRead) =>
  analyticsView({
    config,
    cookie,
    viewer: { kind: 'signed-in', userId: 'user1', read },
  });

test('a signed-in viewer captures on the stored choice, and adopts a real difference', () => {
  const denied = consent('denied');
  assert({
    given: 'a stored choice that matches, differs, or does not exist',
    should: 'use the stored choice, and adopt only when the two differ',
    actual: [
      signedIn({ kind: 'found', stored: cookie }),
      signedIn({ kind: 'found', stored: denied }),
      signedIn({ kind: 'found', stored: null }),
    ],
    expected: [
      {
        available,
        choice: { kind: 'known', consent: cookie },
        capture: capture({}),
      },
      {
        available,
        choice: { kind: 'known', consent: denied },
        capture: capture({ needsAdoption: true }),
      },
      {
        available,
        choice: { kind: 'known', consent: cookie },
        capture: capture({ needsAdoption: true }),
      },
    ],
  });
});

test('an unread choice is unreadable, whichever read could not answer', () => {
  assert({
    given: 'a refused consent read, and an unavailable identity',
    should: 'carry no consent and no capture, so nothing can overwrite it',
    actual: [
      signedIn({ kind: 'refused' }),
      analyticsView({ config, cookie, viewer: { kind: 'unavailable' } }),
    ],
    expected: [unreadable, unreadable],
  });
});

test('a signed-out viewer has the cookie as their choice, and adopts nothing', () => {
  assert({
    given: 'a signed-out viewer',
    should: 'know the cookie and capture with no user',
    actual: analyticsView({ config, cookie, viewer: { kind: 'signed-out' } }),
    expected: {
      available,
      choice: { kind: 'known', consent: cookie },
      capture: capture({ userId: null }),
    },
  });
});

test('stored consent is read only for a signed-in viewer on a keyed deployment', async () => {
  const reads: string[] = [];
  const readConsent = async (userId: string) => {
    reads.push(userId);
    return null;
  };
  const principal = { kind: 'anonymous' } as const;
  const views = [
    await readViewerAnalytics({
      config,
      identity: member,
      cookie,
      readConsent,
    }),
    await readViewerAnalytics({
      config,
      identity: { state: 'anonymous', principal },
      cookie,
      readConsent,
    }),
    await readViewerAnalytics({
      config,
      identity: { state: 'unavailable', principal, temporary: true },
      cookie,
      readConsent,
    }),
    await readViewerAnalytics({
      config: { ...config, key: null },
      identity: member,
      cookie,
      readConsent,
    }),
    await readViewerAnalytics({
      config,
      identity: member,
      cookie,
      readConsent: refused,
    }),
  ];
  const knownCookie = { kind: 'known', consent: cookie };
  assert({
    given:
      'a member, a signed-out viewer, a refused identity, no key, and a member whose read is refused',
    should:
      'read for the member alone, and answer each with its own whole view',
    actual: { reads, views },
    expected: {
      reads: ['user1'],
      views: [
        {
          available,
          choice: knownCookie,
          capture: capture({ needsAdoption: true }),
        },
        {
          available,
          choice: knownCookie,
          capture: capture({ userId: null }),
        },
        unreadable,
        { available, choice: knownCookie, capture: null },
        unreadable,
      ],
    },
  });
});
