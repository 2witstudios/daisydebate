import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import {
  analyticsView,
  readStoredConsent,
  readViewerAnalytics,
} from './viewer-analytics';
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

const cookie = consent('granted');
const unreadable = {
  available: config.available,
  choice: { kind: 'unreadable' },
  capture: null,
};
const capture = (over: object) => ({
  keyValue: 'key',
  host: config.host,
  userId: 'user1',
  needsAdoption: false,
  consent: cookie,
  ...over,
});

test('capture runs only on a known choice, and adopts only a real difference', () => {
  const view = (read: Parameters<typeof analyticsView>[0]['read']) =>
    analyticsView({ config, identity: member, cookie, read }).capture;
  const denied = consent('denied');
  assert({
    given: 'a member whose stored choice matches, differs, or does not exist',
    should: 'capture on the stored choice, and adopt when the two differ',
    actual: [
      view({ kind: 'found', stored: cookie }),
      view({ kind: 'found', stored: denied }),
      view({ kind: 'found', stored: null }),
    ],
    expected: [
      capture({}),
      capture({ needsAdoption: true, consent: denied }),
      capture({ needsAdoption: true }),
    ],
  });
});

test('an unread choice is unreadable, whichever read could not answer', () => {
  const principal = { kind: 'anonymous' } as const;
  assert({
    given: 'a refused consent read, and identities that left it unread',
    should: 'carry no consent and no capture, so nothing can overwrite it',
    actual: [
      analyticsView({
        config,
        identity: member,
        cookie,
        read: { kind: 'refused' },
      }),
      analyticsView({
        config,
        identity: { state: 'unavailable', principal, temporary: true },
        cookie,
        read: { kind: 'not-asked' },
      }),
      analyticsView({
        config,
        identity: { state: 'unavailable', principal },
        cookie,
        read: { kind: 'not-asked' },
      }),
    ],
    expected: [unreadable, unreadable, unreadable],
  });
});

test('a viewer with nothing stored has the cookie as their choice', () => {
  const anonymous = {
    state: 'anonymous',
    principal: { kind: 'anonymous' },
  } as const;
  assert({
    given: 'a signed-out viewer, and a deployment with no key',
    should: 'know the cookie; capture only where there is a key',
    actual: [
      analyticsView({
        config,
        identity: anonymous,
        cookie,
        read: { kind: 'not-asked' },
      }),
      analyticsView({
        config: { ...config, key: null },
        identity: { state: 'unavailable', principal: { kind: 'anonymous' } },
        cookie,
        read: { kind: 'not-asked' },
      }),
    ],
    expected: [
      {
        available: config.available,
        choice: { kind: 'known', consent: cookie },
        capture: capture({ userId: null }),
      },
      {
        available: config.available,
        choice: { kind: 'known', consent: cookie },
        capture: null,
      },
    ],
  });
});

test('stored consent is read only for a signed-in viewer on a keyed deployment', async () => {
  const reads: string[] = [];
  const readConsent = async (userId: string) => {
    reads.push(userId);
    return null;
  };
  const anonymous = {
    state: 'anonymous',
    principal: { kind: 'anonymous' },
  } as const;
  await readViewerAnalytics({ config, identity: member, cookie, readConsent });
  await readViewerAnalytics({
    config,
    identity: anonymous,
    cookie,
    readConsent,
  });
  await readViewerAnalytics({
    config: { ...config, key: null },
    identity: member,
    cookie,
    readConsent,
  });
  assert({
    given: 'a member, a signed-out viewer, and a member with no key configured',
    should: 'read once, for the first',
    actual: reads,
    expected: ['user1'],
  });
});
