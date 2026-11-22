import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  canClaimPreapproval,
  decidePreapprovalChange,
  preapprovalEmailSchema,
} from './beta-preapproval';
import { normalizeEmail } from './email';
setupRitewayBun();
describe('beta email preapproval policy', () => {
  test('email identity preserves provider-specific addressing', () => {
    assert({
      given: 'mixed case and surrounding spaces with dots and a plus tag',
      should: 'match only the trimmed case-insensitive identity',
      actual: normalizeEmail('  A.B+beta@Example.Test  '),
      expected: 'a.b+beta@example.test',
    });
    assert({
      given: 'a malformed email',
      should: 'refuse saving it',
      actual: preapprovalEmailSchema.safeParse('bad').success,
      expected: false,
    });
  });
  test('claims require verified eligible pending identity', () => {
    const eligible = {
      verified: true,
      erased: false,
      restricted: false,
      state: 'pending',
      ageBand: 'adult',
    };
    const cases = [
      eligible,
      { ...eligible, verified: false },
      { ...eligible, erased: true },
      { ...eligible, restricted: true },
      { ...eligible, state: 'revoked' },
      { ...eligible, state: 'approved' },
      { ...eligible, state: null },
      { ...eligible, ageBand: null },
      { ...eligible, ageBand: 'under-13' },
      { ...eligible, ageBand: '13-15' },
      { ...eligible, ageBand: '16-17' },
    ];
    assert({
      given:
        'pending, unverified, erased, moderated, revoked, approved and age-ineligible identities',
      should:
        'admit only verified unrestricted pending accounts aged 13+ (decision 88)',
      actual: cases.map(canClaimPreapproval),
      expected: [
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        true,
        true,
      ],
    });
  });
});

test('preapproval command decisions preserve revision, one-invitation and account authority', () => {
  const grant = {
    id: 'g'.repeat(24),
    revision: 2,
    claimed: false,
    invited: false,
  };
  const base = {
    v: 1,
    commandId: 'c'.repeat(24),
    adminAuditHead: 'a'.repeat(64),
  } as const;
  const invite = {
    ...base,
    operation: 'invite',
    preapprovalId: grant.id,
    expectedRevision: 2,
  } as const;
  const decide = (
    options: Partial<Parameters<typeof decidePreapprovalChange>[0]> = {},
  ) =>
    decidePreapprovalChange({
      command: invite,
      grant,
      claimedAccount: {
        verified: true,
        emailMatches: true,
        erased: false,
        restricted: false,
        state: 'approved',
        ageBand: 'adult',
      },
      activeInvitation: false,
      ...options,
    });
  assert({
    given:
      'a fresh invite, active invitation, silent add, removed grant, stale form and revoked claimed account',
    should:
      'queue exactly the owed invitation and refuse stale or inappropriate effects',
    actual: [
      decide(),
      decide({ activeInvitation: true }),
      decide({
        command: {
          ...base,
          operation: 'add',
          email: 'person@example.test',
          invite: false,
        },
      }),
      decide({ grant: null }),
      decide({ command: { ...invite, expectedRevision: 1 } }),
      decide({
        grant: { ...grant, claimed: true },
        claimedAccount: {
          verified: true,
          emailMatches: true,
          erased: false,
          restricted: false,
          state: 'revoked',
          ageBand: 'adult',
        },
      }),
    ].map(
      (decision) =>
        decision &&
        ('result' in decision
          ? [decision.kind, decision.result.mail, decision.result.revision]
          : [decision.kind, decision.code]),
    ),
    expected: [
      ['save', 'queued', 3],
      ['save', 'none', 3],
      ['save', 'none', 2],
      ['refused', 'NOT_FOUND'],
      ['refused', 'CONFLICT'],
      ['refused', 'CONFLICT'],
    ],
  });
});
