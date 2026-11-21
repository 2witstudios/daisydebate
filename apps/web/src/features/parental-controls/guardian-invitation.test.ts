import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  childBand,
  claimInvitations,
  decideChildAccount,
  invitationExpiresAt,
  type ChildAccountFacts,
  type ClaimableInvitation,
} from './guardian-invitation';

setupRitewayBun();

const now = '2026-11-19T12:00:00.000Z';
const parent = 'p'.repeat(24);
const facts = (
  overrides: Partial<ChildAccountFacts> = {},
): ChildAccountFacts => ({
  now,
  parent: { userId: parent, email: 'sam@example.test', ageBand: 'adult' },
  parentInvitedAddress: false,
  holder: { kind: 'nobody' },
  ...overrides,
});
const command = { birthMonth: '2012-03', email: 'ada@example.test' };

test('a birth month a parent gives', () => {
  assert({
    given: 'months either side of 13 and 18 in November 2026',
    should:
      'admit only 13 to 17, counting a person that age for the month they turn it',
    actual: ['2013-12', '2013-11', '2009-01', '2008-12', '2008-11'].map(
      (month) => childBand(month, now),
    ),
    expected: ['under-13', 'minor', 'minor', 'minor', 'not-a-minor'],
  });
});

test('creating a child’s account', () => {
  assert({
    given: 'an adult parent and an address nobody holds',
    should: 'invite: store the invitation and send the sign-in link',
    actual: decideChildAccount(facts(), command),
    expected: { kind: 'invite' },
  });
  assert({
    given: 'a child under 13, or 18 and over',
    should: 'refuse each with its own reason',
    actual: [
      decideChildAccount(facts(), { ...command, birthMonth: '2014-01' }),
      decideChildAccount(facts(), { ...command, birthMonth: '2005-06' }),
    ],
    expected: [
      { kind: 'refused', refusal: 'under-13' },
      { kind: 'refused', refusal: 'not-a-minor' },
    ],
  });
  assert({
    given: 'a minor or unknown-age person acting as parent',
    should: 'refuse: only an adult is a guardian',
    actual: [
      decideChildAccount(
        facts({
          parent: { userId: parent, email: 'x@y.test', ageBand: '16-17' },
        }),
        command,
      ),
      decideChildAccount(
        facts({ parent: { userId: parent, email: 'x@y.test', ageBand: null } }),
        command,
      ),
    ].map((decision) => decision.kind === 'refused' && decision.refusal),
    expected: ['not-an-adult', 'not-an-adult'],
  });
  assert({
    given: 'the parent’s own address, typed or held by their own account',
    should: 'refuse as their own email',
    actual: [
      decideChildAccount(facts(), { ...command, email: 'sam@example.test' }),
      decideChildAccount(
        facts({
          holder: {
            kind: 'account',
            userId: parent,
            ageBand: 'adult',
            linkedToParent: false,
          },
        }),
        command,
      ),
    ],
    expected: [
      { kind: 'refused', refusal: 'own-email' },
      { kind: 'refused', refusal: 'own-email' },
    ],
  });
  assert({
    given: 'a live invitation from this parent to the same address',
    should: 'refuse a second one',
    actual: decideChildAccount(facts({ parentInvitedAddress: true }), command),
    expected: { kind: 'refused', refusal: 'already-linked' },
  });
});

test('an address someone already holds', () => {
  const holder = (ageBand: '13-15' | '16-17' | 'adult' | null) =>
    facts({
      holder: {
        kind: 'account',
        userId: 'c'.repeat(24),
        ageBand,
        linkedToParent: false,
      },
    });
  assert({
    given: 'a minor’s account at the address',
    should: 'ask that account to confirm the parent instead',
    actual: [
      decideChildAccount(holder('13-15'), command),
      decideChildAccount(holder('16-17'), command),
    ],
    expected: [
      { kind: 'ask-existing', minorUserId: 'c'.repeat(24) },
      { kind: 'ask-existing', minorUserId: 'c'.repeat(24) },
    ],
  });
  assert({
    given: 'an adult’s account, or one with no age yet',
    should:
      'tell the holder nothing changed, and the parent the same as always',
    actual: [
      decideChildAccount(holder('adult'), command),
      decideChildAccount(holder(null), command),
    ],
    expected: [{ kind: 'tell-holder' }, { kind: 'tell-holder' }],
  });
  assert({
    given: 'a child this parent is already linked to or waiting on',
    should: 'leave the existing link alone without revealing the account',
    actual: decideChildAccount(
      facts({
        holder: {
          kind: 'account',
          userId: 'c'.repeat(24),
          ageBand: '13-15',
          linkedToParent: true,
        },
      }),
      command,
    ),
    expected: { kind: 'tell-holder' },
  });
});

test('the child’s first sign-in claims the invitation', () => {
  const invitation = (
    id: string,
    createdAt: string,
    overrides: Partial<ClaimableInvitation> = {},
  ): ClaimableInvitation => ({
    id: id.repeat(24),
    guardianUserId: `${id}g`.padEnd(24, 'g'),
    guardianConsentId: `${id}e`.padEnd(24, 'e'),
    birthMonth: '2012-03',
    createdAt,
    status: 'open',
    expiresAt: invitationExpiresAt(createdAt),
    guardianAdmitted: true,
    ...overrides,
  });
  const first = invitation('a', '2026-11-10T00:00:00.000Z');
  const second = invitation('b', '2026-11-12T00:00:00.000Z', {
    birthMonth: '2012-04',
    guardianAdmitted: false,
  });
  assert({
    given: 'two parents’ live invitations to the same address',
    should:
      'let the earliest make the account, with its birth month, and ask the other',
    actual: claimInvitations([second, first], now),
    expected: {
      created: first,
      birthMonth: '2012-03',
      asked: [second],
      admitted: true,
    },
  });
  assert({
    given: 'an expired, invalid, cancelled or no-longer-minor invitation',
    should: 'claim nothing: the child onboards like anyone else',
    actual: [
      claimInvitations([invitation('c', '2026-10-01T00:00:00.000Z')], now),
      claimInvitations(
        [invitation('f', '2026-11-18T00:00:00.000Z', { expiresAt: 'invalid' })],
        now,
      ),
      claimInvitations(
        [invitation('d', '2026-11-18T00:00:00.000Z', { status: 'cancelled' })],
        now,
      ),
      claimInvitations(
        [
          invitation('e', '2026-11-18T00:00:00.000Z', {
            birthMonth: '2008-11',
          }),
        ],
        now,
      ),
    ],
    expected: [null, null, null, null],
  });
  assert({
    given: 'an invitation from a parent not admitted to the beta',
    should: 'not admit the child with it',
    actual: claimInvitations([second], now)?.admitted,
    expected: false,
  });
});
