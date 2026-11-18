import type { ParentLinkRead } from '@daisy/db';
import type {
  MediaReleaseRecord,
  ReleaseRequest,
} from '@daisy/protocol/media-release';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  managePageOf,
  parentRefusalWords,
  signBodyOf,
  signPageOf,
  withdrawBodyOf,
} from './parent-pages';

setupRitewayBun();

const t0 = Date.parse('2026-11-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

const request = (overrides: Partial<ReleaseRequest> = {}): ReleaseRequest => ({
  id: 'r'.repeat(24),
  subjectUserId: 'm'.repeat(24),
  recipientEmail: 'elena@example.com',
  requestedAt: iso(t0),
  expiresAt: iso(t0 + 14 * DAY),
  outcome: null,
  resolvedAt: null,
  sends: 1,
  lastSentAt: iso(t0),
  ...overrides,
});

const publish: MediaReleaseRecord = {
  id: 'p'.repeat(24),
  subjectUserId: 'm'.repeat(24),
  scope: 'publish',
  attestation: {
    kind: 'parent',
    name: 'Elena',
    relation: 'parent',
    email: 'elena@example.com',
  },
  wordingVersion: '2026-11-v1',
  signedAt: iso(t0 + DAY),
  withdrawnAt: null,
  withdrawnBy: null,
};

const link = (
  overrides: Partial<Extract<ParentLinkRead, { kind: 'link' }>> = {},
): ParentLinkRead => ({
  kind: 'link',
  verdict: 'usable',
  request: request(),
  minor: { username: 'sam.rivera' },
  standing: { kind: 'none' },
  held: { publish: null, paidAds: null },
  ...overrides,
});

test('the sign page', () => {
  assert({
    given: 'a usable link to an open request',
    should: 'show the form with the request’s facts',
    actual: signPageOf(link(), t0 + DAY),
    expected: {
      kind: 'form',
      minor: 'sam.rivera',
      requestedAt: iso(t0),
      expiresAt: iso(t0 + 14 * DAY),
      sentTo: 'elena@example.com',
    },
  });
  assert({
    given: 'a link to a request it already signed',
    should: 'say it is signed',
    actual: signPageOf(
      link({ verdict: 'used', request: request({ outcome: 'signed' }) }),
      t0 + DAY,
    ).kind,
    expected: 'signed',
  });
  assert({
    given: 'a request past its expiry',
    should: 'say the link expired',
    actual: signPageOf(link(), t0 + 15 * DAY).kind,
    expected: 'expired',
  });
  assert({
    given: 'a cancelled request, or a release the club already confirmed',
    should: 'say the request is closed',
    actual: [
      signPageOf(link({ request: request({ outcome: 'cancelled' }) }), t0).kind,
      signPageOf(
        link({ standing: { kind: 'on_file', publish, paidAds: false } }),
        t0,
      ).kind,
    ],
    expected: ['closed', 'closed'],
  });
  assert({
    given: 'an unknown link, or a minor whose account is gone',
    should: 'show nothing of the request',
    actual: [
      signPageOf({ kind: 'unknown' }, t0).kind,
      signPageOf(link({ minor: { username: null } }), t0).kind,
    ],
    expected: ['unknown', 'unknown'],
  });
});

test('the manage page', () => {
  assert({
    given: 'a usable link and a publish release with no paid ads',
    should: 'show the form, paid ads not allowed',
    actual: managePageOf(link({ held: { publish, paidAds: null } })),
    expected: {
      kind: 'form',
      minor: 'sam.rivera',
      signedAt: publish.signedAt,
      paidAds: false,
    },
  });
  assert({
    given: 'no link, a used link, or an expired one',
    should: 'ask for a new link, saying why',
    actual: [
      managePageOf(null),
      managePageOf(link({ verdict: 'used' })),
      managePageOf(link({ verdict: 'expired' })),
    ],
    expected: [
      { kind: 'ask_for_link', why: 'none' },
      { kind: 'ask_for_link', why: 'used' },
      { kind: 'ask_for_link', why: 'expired' },
    ],
  });
  assert({
    given: 'a usable link with nothing left on file',
    should: 'say there is nothing to manage',
    actual: managePageOf(link()),
    expected: { kind: 'nothing', minor: 'sam.rivera' },
  });
});

test('the posted forms', () => {
  const form = new FormData();
  form.set('name', 'Elena Rivera');
  form.set('relation', 'legal_guardian');
  form.set('attests', 'on');
  assert({
    given: 'a sign form with the box ticked and paid ads not',
    should: 'post the token and the fields, paid ads off',
    actual: signBodyOf('tok', form),
    expected: {
      token: 'tok',
      form: {
        name: 'Elena Rivera',
        relation: 'legal_guardian',
        attests: true,
        paidAds: false,
      },
    },
  });
  const withdraw = new FormData();
  withdraw.set('what', 'whole');
  assert({
    given: 'a withdraw form without the attestation',
    should: 'post it unticked, for the route to refuse',
    actual: withdrawBodyOf('tok', withdraw),
    expected: {
      token: 'tok',
      form: { what: 'whole', attests: false, note: '' },
    },
  });
  assert({
    given: 'a reason the route answers, and one it never does',
    should: 'say each plainly',
    actual: [parentRefusalWords('used'), parentRefusalWords('something-else')],
    expected: [
      'This link has already been used. Check your email for a newer one.',
      'This link does not work.',
    ],
  });
});
