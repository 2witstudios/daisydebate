import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  decidePreapprovalChange,
  canInviteClaimedPreapproval,
  INVITABLE_AGE_BANDS,
} from './beta-preapproval-decision';
import { ADMITTED_AGE_BANDS } from '@daisy/auth/age-floor';
setupRitewayBun();

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
      claimedAccountInvitable: true,
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
        claimedAccountInvitable: false,
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

test('claimed invitation eligibility follows current verified identity and access', () => {
  const eligible = {
    verified: true,
    emailMatches: true,
    erased: false,
    restricted: false,
    state: 'approved',
    ageBand: 'adult',
  };
  assert({
    given:
      'an eligible claimed account and changed email, unverified email, a 13-15 account, an age corrected under 13 or gone, revocation, moderation or erasure',
    should: 'invite only the current matching eligible account',
    actual: [
      eligible,
      { ...eligible, emailMatches: false },
      { ...eligible, verified: false },
      { ...eligible, ageBand: '13-15' },
      { ...eligible, ageBand: 'under-13' },
      { ...eligible, ageBand: null },
      { ...eligible, state: 'revoked' },
      { ...eligible, restricted: true },
      { ...eligible, erased: true },
    ].map(canInviteClaimedPreapproval),
    expected: [true, false, false, true, false, false, false, false, false],
  });
});

test("the invitable age bands are the account floor's", () => {
  assert({
    given:
      'the bands a claimed grant may invite and the bands @daisy/auth admits',
    should: 'be the same, so the floor has one owner',
    actual: INVITABLE_AGE_BANDS,
    expected: ADMITTED_AGE_BANDS,
  });
});
