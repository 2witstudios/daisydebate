import { instantMs } from '@daisy/clock';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  activeReleaseOf,
  clubConfirmVerdict,
  decideAnswer,
  decideAsk,
  decideClubConfirm,
  everyDebaterReleased,
  decidePaidAdsChange,
  decideResend,
  decideSignature,
  decideWithdrawal,
  isReleaseRequestOpen,
  maskEmail,
  mediaReleasePolicy,
  mediaReleaseWording,
  parentHeldOf,
  releaseLinkVerdict,
  releaseRequestExpiry,
  releaseRequestStanding,
  releaseStandingOf,
  reuseFenced,
  type ClubStudent,
  type MediaReleaseRecord,
  type ReleaseRequest,
  type ReleaseStanding,
} from './media-release';

setupRitewayBun();

const minor = 'm'.repeat(24);
const t0 = instantMs('2026-11-15T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

const request = (overrides: Partial<ReleaseRequest> = {}): ReleaseRequest => ({
  id: 'r'.repeat(24),
  subjectUserId: minor,
  recipientEmail: 'elena.rivera@fastmail.com',
  requestedAt: iso(t0),
  expiresAt: releaseRequestExpiry(t0),
  outcome: null,
  resolvedAt: null,
  sends: 1,
  lastSentAt: iso(t0),
  ...overrides,
});

const parentRelease = (
  overrides: Partial<MediaReleaseRecord> = {},
): MediaReleaseRecord => ({
  id: 'p'.repeat(24),
  subjectUserId: minor,
  scope: 'publish',
  attestation: {
    kind: 'parent',
    name: 'Elena Rivera',
    relation: 'parent',
    email: 'elena.rivera@fastmail.com',
  },
  wordingVersion: mediaReleaseWording.version,
  signedAt: iso(t0 + DAY),
  withdrawnAt: null,
  withdrawnBy: null,
  ...overrides,
});

const clubRelease = (
  overrides: Partial<MediaReleaseRecord> = {},
): MediaReleaseRecord => ({
  ...parentRelease(),
  id: 'c'.repeat(24),
  attestation: {
    kind: 'club',
    organizationId: 'o'.repeat(24),
    organizationName: 'Lakeside Debate',
    attestedByUserId: 'd'.repeat(24),
    name: 'Dana Mensah',
    role: 'Coach',
  },
  ...overrides,
});

const none: ReleaseStanding = { kind: 'none' };

test('a request lifecycle', () => {
  assert({
    given: 'a request made now',
    should: 'expire 14 days later',
    actual: releaseRequestExpiry(t0),
    expected: iso(t0 + 14 * DAY),
  });
  assert({
    given: 'an unanswered request before its expiry',
    should: 'be open',
    actual: releaseRequestStanding(request(), t0 + 13 * DAY),
    expected: 'open',
  });
  assert({
    given: 'an unanswered request at its expiry',
    should: 'be expired, and no longer open',
    actual: [
      releaseRequestStanding(request(), t0 + 14 * DAY),
      isReleaseRequestOpen(request(), t0 + 14 * DAY),
    ],
    expected: ['expired', false],
  });
  assert({
    given: 'a signed request, even after its expiry',
    should: 'stand as signed',
    actual: releaseRequestStanding(
      request({ outcome: 'signed' }),
      t0 + 20 * DAY,
    ),
    expected: 'signed',
  });
});

test('one active release per minor per scope', () => {
  const withdrawn = parentRelease({
    id: 'w'.repeat(24),
    withdrawnAt: iso(t0 + 2 * DAY),
    withdrawnBy: 'parent',
  });
  assert({
    given: 'a withdrawn and an active publish release',
    should: 'answer the active one',
    actual: activeReleaseOf([withdrawn, parentRelease()], minor, 'publish')?.id,
    expected: 'p'.repeat(24),
  });
  assert({
    given: 'only a publish release',
    should: 'hold no paid-ads release',
    actual: activeReleaseOf([parentRelease()], minor, 'paid_ads'),
    expected: null,
  });
  assert({
    given: 'another minor’s release',
    should: 'not count',
    actual: activeReleaseOf([parentRelease()], 'x'.repeat(24), 'publish'),
    expected: null,
  });
});

test('where a minor stands', () => {
  const at = (
    releases: readonly MediaReleaseRecord[],
    requests: readonly ReleaseRequest[],
    nowMs = t0 + DAY,
  ) =>
    releaseStandingOf({ subjectUserId: minor, releases, requests, nowMs }).kind;
  assert({
    given: 'nothing',
    should: 'be none',
    actual: at([], []),
    expected: 'none',
  });
  assert({
    given: 'an open request',
    should: 'be waiting',
    actual: at([], [request()]),
    expected: 'waiting',
  });
  assert({
    given: 'only an expired request',
    should: 'be none',
    actual: at([], [request()], t0 + 15 * DAY),
    expected: 'none',
  });
  assert({
    given: 'an active publish release and an open request',
    should: 'be on file',
    actual: at([parentRelease()], [request()]),
    expected: 'on_file',
  });
  assert({
    given: 'a publish and a paid-ads release',
    should: 'say paid ads are allowed',
    actual: releaseStandingOf({
      subjectUserId: minor,
      releases: [
        parentRelease(),
        parentRelease({ id: 'a'.repeat(24), scope: 'paid_ads' }),
      ],
      requests: [],
      nowMs: t0,
    }),
    expected: { kind: 'on_file', publish: parentRelease(), paidAds: true },
  });
  assert({
    given: 'a release the parent withdrew',
    should: 'be withdrawn',
    actual: at(
      [
        parentRelease({
          withdrawnAt: iso(t0 + 2 * DAY),
          withdrawnBy: 'parent',
        }),
      ],
      [],
    ),
    expected: 'withdrawn',
  });
  assert({
    given: 'a release the club withdrew',
    should: 'be none',
    actual: at(
      [clubRelease({ withdrawnAt: iso(t0 + 2 * DAY), withdrawnBy: 'club' })],
      [],
    ),
    expected: 'none',
  });
  assert({
    given: 'a parent withdrawal followed by a new open request',
    should: 'be waiting',
    actual: at(
      [parentRelease({ withdrawnAt: iso(t0), withdrawnBy: 'parent' })],
      [request()],
    ),
    expected: 'waiting',
  });
});

test('masking an address', () => {
  assert({
    given: 'an address',
    should: 'show its first character and domain',
    actual: maskEmail('elena.rivera@fastmail.com'),
    expected: 'e•••••@fastmail.com',
  });
  assert({
    given: 'no local part',
    should: 'show nothing of it',
    actual: maskEmail('@x.com'),
    expected: '•••••',
  });
});

test('a minor asks', () => {
  const facts = {
    youth: true,
    standing: none,
    recipientStopped: false,
    asksToday: 0,
  };
  assert({
    given: 'a youth member and a valid address',
    should: 'ask that address, normalised',
    actual: decideAsk(facts, ' Elena.Rivera@Fastmail.com '),
    expected: {
      ok: true,
      recipientEmail: 'elena.rivera@fastmail.com',
      cancels: null,
    },
  });
  assert({
    given: 'an open request already',
    should: 'replace it',
    actual: decideAsk(
      {
        ...facts,
        standing: {
          kind: 'waiting',
          request: request(),
          afterParentWithdrawal: false,
        },
      },
      'other@example.com',
    ),
    expected: {
      ok: true,
      recipientEmail: 'other@example.com',
      cancels: 'r'.repeat(24),
    },
  });
  assert({
    given: 'an adult',
    should: 'refuse',
    actual: decideAsk({ ...facts, youth: false }, 'a@b.co'),
    expected: { ok: false, refusal: 'not_youth' },
  });
  assert({
    given: 'a release already on file',
    should: 'refuse',
    actual: decideAsk(
      {
        ...facts,
        standing: { kind: 'on_file', publish: parentRelease(), paidAds: false },
      },
      'a@b.co',
    ),
    expected: { ok: false, refusal: 'already_released' },
  });
  assert({
    given: 'not an address',
    should: 'refuse',
    actual: decideAsk(facts, 'elena'),
    expected: { ok: false, refusal: 'invalid_email' },
  });
  assert({
    given: 'an address that stopped release requests',
    should: 'refuse',
    actual: decideAsk({ ...facts, recipientStopped: true }, 'a@b.co'),
    expected: { ok: false, refusal: 'recipient_stopped' },
  });
  assert({
    given: 'the day’s requests used up',
    should: 'refuse',
    actual: decideAsk(
      { ...facts, asksToday: mediaReleasePolicy.requestsPerDay },
      'a@b.co',
    ),
    expected: { ok: false, refusal: 'too_many' },
  });
});

test('sending again', () => {
  assert({
    given: 'an open request last sent 10 minutes ago',
    should: 'send',
    actual: decideResend(request(), t0 + 10 * 60 * 1000),
    expected: { ok: true },
  });
  assert({
    given: 'a send a minute ago',
    should: 'refuse as too soon',
    actual: decideResend(request(), t0 + 60 * 1000),
    expected: { ok: false, refusal: 'too_soon' },
  });
  assert({
    given: 'every send used',
    should: 'refuse',
    actual: decideResend(request({ sends: 5 }), t0 + DAY),
    expected: { ok: false, refusal: 'too_many' },
  });
  assert({
    given: 'an expired request',
    should: 'refuse',
    actual: decideResend(request(), t0 + 15 * DAY),
    expected: { ok: false, refusal: 'not_open' },
  });
});

test('a link', () => {
  const link = {
    purpose: 'sign',
    expiresAt: iso(t0 + DAY),
    consumedAt: null,
  } as const;
  assert({
    given: 'an unused link before its expiry',
    should: 'be usable',
    actual: releaseLinkVerdict(link, 'sign', t0),
    expected: 'usable',
  });
  assert({
    given: 'a used link',
    should: 'be used: single use',
    actual: releaseLinkVerdict({ ...link, consumedAt: iso(t0) }, 'sign', t0),
    expected: 'used',
  });
  assert({
    given: 'a link at its expiry',
    should: 'be expired',
    actual: releaseLinkVerdict(link, 'sign', t0 + DAY),
    expected: 'expired',
  });
  assert({
    given: 'no link, or one for the other purpose',
    should: 'be unknown',
    actual: [
      releaseLinkVerdict(null, 'sign', t0),
      releaseLinkVerdict(link, 'manage', t0),
    ],
    expected: ['unknown', 'unknown'],
  });
});

test('a parent signs', () => {
  const facts = {
    link: 'usable',
    request: request(),
    standing: none,
    nowMs: t0,
  } as const;
  const form = {
    name: ' Elena Rivera ',
    relation: 'parent',
    attests: true,
    wordingVersion: mediaReleaseWording.version,
    paidAds: false,
  };
  assert({
    given: 'missing or stale release wording',
    should: 'refuse without accepting consent',
    actual: [undefined, '2026-11-v1'].map(
      (wordingVersion) =>
        decideSignature(facts, { ...form, wordingVersion }).ok,
    ),
    expected: [false, false],
  });
  assert({
    given: 'a usable link and a complete form without paid ads',
    should: 'release publishing only, signed by the addressee',
    actual: decideSignature(facts, form),
    expected: {
      ok: true,
      scopes: ['publish'],
      wordingVersion: mediaReleaseWording.version,
      signature: {
        kind: 'parent',
        name: 'Elena Rivera',
        relation: 'parent',
        email: 'elena.rivera@fastmail.com',
      },
    },
  });
  assert({
    given: 'paid ads ticked',
    should: 'release publishing and paid ads',
    actual: decideSignature(facts, { ...form, paidAds: true }),
    expected: {
      ok: true,
      scopes: ['publish', 'paid_ads'],
      wordingVersion: mediaReleaseWording.version,
      signature: {
        kind: 'parent',
        name: 'Elena Rivera',
        relation: 'parent',
        email: 'elena.rivera@fastmail.com',
      },
    },
  });
  assert({
    given: 'no attestation',
    should: 'refuse',
    actual: decideSignature(facts, { ...form, attests: false }),
    expected: { ok: false, refusal: 'invalid_form' },
  });
  assert({
    given: 'an empty name',
    should: 'refuse',
    actual: decideSignature(facts, { ...form, name: '  ' }),
    expected: { ok: false, refusal: 'invalid_form' },
  });
  assert({
    given: 'a used link',
    should: 'refuse as used',
    actual: decideSignature({ ...facts, link: 'used' }, form),
    expected: { ok: false, refusal: 'used' },
  });
  assert({
    given: 'a cancelled request',
    should: 'refuse as closed',
    actual: decideSignature(
      { ...facts, request: request({ outcome: 'cancelled' }) },
      form,
    ),
    expected: { ok: false, refusal: 'request_closed' },
  });
  assert({
    given: 'a release already on file',
    should: 'refuse',
    actual: decideSignature(
      {
        ...facts,
        standing: { kind: 'on_file', publish: clubRelease(), paidAds: false },
      },
      form,
    ),
    expected: { ok: false, refusal: 'already_released' },
  });
  assert({
    given: 'a decline through a usable link to an open request',
    should: 'be accepted',
    actual: decideAnswer({ link: 'usable', request: request(), nowMs: t0 }),
    expected: { ok: true },
  });
  assert({
    given: 'a decline through an expired link',
    should: 'refuse',
    actual: decideAnswer({ link: 'expired', request: request(), nowMs: t0 }),
    expected: { ok: false, refusal: 'expired' },
  });
});

test('a parent withdraws or changes paid ads', () => {
  const paidAds = parentRelease({ id: 'a'.repeat(24), scope: 'paid_ads' });
  const held = parentHeldOf(
    [parentRelease(), paidAds, clubRelease({ scope: 'publish' })],
    minor,
    'elena.rivera@fastmail.com',
  );
  assert({
    given: 'a parent’s own releases beside a club’s',
    should: 'hold only the parent’s',
    actual: [held.publish?.id, held.paidAds?.id],
    expected: ['p'.repeat(24), 'a'.repeat(24)],
  });
  assert({
    given: 'the whole release',
    should: 'withdraw both scopes',
    actual: decideWithdrawal(held, { what: 'whole', attests: true, note: '' }),
    expected: {
      ok: true,
      withdraw: ['p'.repeat(24), 'a'.repeat(24)],
      note: null,
    },
  });
  assert({
    given: 'paid ads only, with a note',
    should: 'withdraw paid ads and keep the note',
    actual: decideWithdrawal(held, {
      what: 'paid_ads',
      attests: true,
      note: ' moved ',
    }),
    expected: { ok: true, withdraw: ['a'.repeat(24)], note: 'moved' },
  });
  assert({
    given: 'paid ads only when none was allowed',
    should: 'refuse: nothing to withdraw',
    actual: decideWithdrawal(
      { publish: parentRelease(), paidAds: null },
      { what: 'paid_ads', attests: true },
    ),
    expected: { ok: false, refusal: 'nothing_to_withdraw' },
  });
  assert({
    given: 'no attestation',
    should: 'refuse',
    actual: decideWithdrawal(held, { what: 'whole', attests: false }),
    expected: { ok: false, refusal: 'invalid_form' },
  });
  assert({
    given: 'allowing paid ads on a publish release',
    should: 'grant paid ads',
    actual: decidePaidAdsChange(
      { publish: parentRelease(), paidAds: null },
      true,
    ),
    expected: { ok: true, change: 'grant' },
  });
  assert({
    given: 'turning paid ads off',
    should: 'withdraw it',
    actual: decidePaidAdsChange(held, false),
    expected: { ok: true, change: 'withdraw', releaseId: 'a'.repeat(24) },
  });
  assert({
    given: 'paid ads with no publish release',
    should: 'refuse',
    actual: decidePaidAdsChange({ publish: null, paidAds: null }, true),
    expected: { ok: false, refusal: 'no_release' },
  });
  assert({
    given: 'the same choice again',
    should: 'refuse as unchanged',
    actual: decidePaidAdsChange(held, true),
    expected: { ok: false, refusal: 'unchanged' },
  });
});

test('a club confirms', () => {
  const student = (overrides: Partial<ClubStudent> = {}): ClubStudent => ({
    userId: minor,
    member: true,
    youth: true,
    standing: none,
    ...overrides,
  });
  const form = {
    warrants: true,
    wordingVersion: mediaReleaseWording.version,
    paidAds: false,
    name: 'Dana Mensah',
    role: 'Coach',
  };
  assert({
    given: 'missing or stale release wording',
    should: 'refuse without accepting consent',
    actual: [undefined, '2026-11-v1'].map(
      (wordingVersion) =>
        decideClubConfirm([student()], { ...form, wordingVersion }).ok,
    ),
    expected: [false, false],
  });
  assert({
    given: 'each standing',
    should: 'admit none and waiting only',
    actual: [
      clubConfirmVerdict(student()),
      clubConfirmVerdict(
        student({
          standing: {
            kind: 'waiting',
            request: request(),
            afterParentWithdrawal: false,
          },
        }),
      ),
      clubConfirmVerdict(
        student({
          standing: {
            kind: 'on_file',
            publish: parentRelease(),
            paidAds: false,
          },
        }),
      ),
      clubConfirmVerdict(
        student({
          standing: {
            kind: 'withdrawn',
            release: parentRelease({
              withdrawnAt: iso(t0),
              withdrawnBy: 'parent',
            }),
          },
        }),
      ),
      clubConfirmVerdict(student({ member: false })),
      clubConfirmVerdict(student({ youth: false })),
    ],
    expected: [
      'eligible',
      'eligible',
      'already_on_file',
      'parent_withdrew',
      'not_a_student',
      'not_a_student',
    ],
  });
  assert({
    given: 'two eligible students, one waiting on a parent',
    should: 'confirm both and supersede the parent request',
    actual: decideClubConfirm(
      [
        student(),
        student({
          userId: 'n'.repeat(24),
          standing: {
            kind: 'waiting',
            request: request(),
            afterParentWithdrawal: false,
          },
        }),
      ],
      form,
    ),
    expected: {
      ok: true,
      scopes: ['publish'],
      wordingVersion: mediaReleaseWording.version,
      name: 'Dana Mensah',
      role: 'Coach',
      confirm: [
        { userId: minor, supersedes: null },
        { userId: 'n'.repeat(24), supersedes: 'r'.repeat(24) },
      ],
    },
  });
  assert({
    given: 'paid ads covered',
    should: 'confirm both scopes',
    actual: decideClubConfirm([student()], { ...form, paidAds: true }),
    expected: {
      ok: true,
      scopes: ['publish', 'paid_ads'],
      wordingVersion: mediaReleaseWording.version,
      name: 'Dana Mensah',
      role: 'Coach',
      confirm: [{ userId: minor, supersedes: null }],
    },
  });
  assert({
    given: 'one student a parent withdrew',
    should: 'refuse all, naming them',
    actual: decideClubConfirm(
      [
        student(),
        student({
          userId: 'k'.repeat(24),
          standing: {
            kind: 'withdrawn',
            release: parentRelease({
              withdrawnAt: iso(t0),
              withdrawnBy: 'parent',
            }),
          },
        }),
      ],
      form,
    ),
    expected: {
      ok: false,
      refusal: 'ineligible',
      ineligible: ['k'.repeat(24)],
    },
  });
  assert({
    given: 'no warranty',
    should: 'refuse',
    actual: decideClubConfirm([student()], { ...form, warrants: false }),
    expected: { ok: false, refusal: 'invalid_form', ineligible: [] },
  });
  assert({
    given: 'nobody selected',
    should: 'refuse',
    actual: decideClubConfirm([], form),
    expected: { ok: false, refusal: 'none_selected', ineligible: [] },
  });
});

test('reusing a Round', () => {
  const a = 'a'.repeat(24);
  const b = 'b'.repeat(24);
  const active = (subjectUserId: string) =>
    parentRelease({
      subjectUserId,
      wordingVersion: mediaReleaseWording.version,
    });
  const youth = { youth: true, debaterUserIds: [a, b] };
  assert({
    given: 'a Round with no youth debater',
    should: 'never be fenced, whatever releases exist',
    actual: reuseFenced({ youth: false, debaterUserIds: [a], releases: [] }),
    expected: false,
  });
  assert({
    given: 'a Youth Round whose every youth debater holds an active release',
    should: 'be open to reuse',
    actual: reuseFenced({ ...youth, releases: [active(a), active(b)] }),
    expected: false,
  });
  assert({
    given: 'a Youth Round with one youth debater unreleased',
    should: 'stay fenced',
    actual: reuseFenced({ ...youth, releases: [active(a)] }),
    expected: true,
  });
  assert({
    given: 'a Youth Round with an old permission to publish',
    should: 'stay fenced until consent covers reuse',
    actual: reuseFenced({
      ...youth,
      releases: [
        active(a),
        parentRelease({ subjectUserId: b, wordingVersion: '2026-11-v1' }),
      ],
    }),
    expected: true,
  });
  assert({
    given: 'a withdrawn release, or only paid ads',
    should: 'not count',
    actual: [
      everyDebaterReleased(
        [a],
        [
          parentRelease({
            ...active(a),
            withdrawnAt: iso(t0),
            withdrawnBy: 'parent',
          }),
        ],
      ),
      everyDebaterReleased(
        [a],
        [parentRelease({ ...active(a), scope: 'paid_ads' })],
      ),
    ],
    expected: [false, false],
  });
  assert({
    given: 'a Youth Round with no youth debater left in its seats',
    should: 'fail closed and stay fenced',
    actual: reuseFenced({ youth: true, debaterUserIds: [], releases: [] }),
    expected: true,
  });
});

test('a parent’s withdrawal outlives a new request', () => {
  const standing = releaseStandingOf({
    subjectUserId: minor,
    releases: [
      parentRelease({ withdrawnAt: iso(t0 + DAY), withdrawnBy: 'parent' }),
    ],
    requests: [
      request({
        requestedAt: iso(t0 + 2 * DAY),
        expiresAt: iso(t0 + 16 * DAY),
      }),
    ],
    nowMs: t0 + 3 * DAY,
  });
  const renewal = releaseStandingOf({
    subjectUserId: minor,
    releases: [clubRelease({ wordingVersion: '2026-11-v1' })],
    requests: [],
    nowMs: t0,
  });
  assert({
    given: 'an active club release signed for publishing only',
    should: 'let a parent or the club provide fresh reuse consent',
    actual: [
      decideAsk(
        {
          youth: true,
          standing: renewal,
          recipientStopped: false,
          asksToday: 0,
        },
        'parent@example.com',
      ).ok,
      clubConfirmVerdict({
        userId: minor,
        member: true,
        youth: true,
        standing: renewal,
      }),
    ],
    expected: [true, 'eligible'],
  });
  assert({
    given: 'a parent withdrew, then the minor asked again',
    should: 'wait on a parent, and still refuse a club’s confirmation',
    actual: [
      standing.kind,
      clubConfirmVerdict({
        userId: minor,
        member: true,
        youth: true,
        standing,
      }),
    ],
    expected: ['waiting', 'parent_withdrew'],
  });
});
