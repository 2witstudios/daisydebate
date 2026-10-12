import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { MessagingInboxPageFacts } from '@daisy/db/messaging';
import { decideMessagingInbox } from './inbox-decision';
import { typingWorld } from './typing.test-support';
setupRitewayBun();

type Candidate = MessagingInboxPageFacts['candidates'][number];
const world = () => {
  const f = typingWorld();
  const [self, peer] = f.accounts as [
    (typeof f.accounts)[number],
    (typeof f.accounts)[number],
  ];
  const accounts = new Map(f.accounts.map((row) => [row.account.actorId, row]));
  const facts = (
    candidates: readonly Candidate[],
    patch: Partial<MessagingInboxPageFacts> = {},
  ): MessagingInboxPageFacts => ({
    principal: { userId: self.account.userId, actorId: self.account.actorId },
    account: self.account,
    accounts,
    contactPairs: [],
    now: f.now,
    candidates,
    ...patch,
  });
  const decide = (actor = self) =>
    decideMessagingInbox({
      principal: {
        kind: 'user',
        userId: actor.account.userId,
        actorId: actor.account.actorId,
      },
      postingPolicy: f.policy.posting,
      readingPolicy: f.policy.reading,
    });
  return { f, self, peer, accounts, facts, decide };
};
const entry = (
  channel: Candidate['channel'],
  patch: Partial<Candidate> = {},
): Candidate => ({
  channelId: channel?.channelId ?? 'g'.repeat(24),
  hidden: false,
  channel,
  invitation: null,
  ...patch,
});

test('each fenced association gets its own current capability, never a shared grant', () => {
  const { f, self, peer, facts, decide } = world();
  const pending = {
    ...f.channel,
    authority: { ...f.channel.authority, state: 'pending' as const },
  };
  const page = (
    actor: typeof self,
    channel: Candidate['channel'],
    accounts?: MessagingInboxPageFacts['accounts'],
  ) =>
    decide(actor).entries(
      facts([entry(channel)], {
        principal: {
          userId: actor.account.userId,
          actorId: actor.account.actorId,
        },
        account: actor.account,
        ...(accounts ? { accounts } : {}),
      }),
    );
  const erasedPeer = new Map([
    [self.account.actorId, self],
    [
      peer.account.actorId,
      { ...peer, account: { ...peer.account, erased: true, member: false } },
    ],
  ]);
  assert({
    given:
      'an accepted DM, a pending DM from each side, an erased peer and a hidden DM',
    should:
      'classify conversation and request direction, and omit ineligible and hidden entries',
    actual: {
      accepted: page(self, f.channel),
      sender: page(self, pending),
      recipient: page(peer, pending),
      erasedPeer: page(self, f.channel, erasedPeer),
      hidden: decide().entries(facts([entry(f.channel, { hidden: true })])),
    },
    expected: {
      accepted: [{ channelId: f.channel.channelId, kind: 'conversation' }],
      sender: [{ channelId: f.channel.channelId, kind: 'outgoing_request' }],
      recipient: [{ channelId: f.channel.channelId, kind: 'incoming_request' }],
      erasedPeer: [],
      hidden: [],
    },
  });
});

test('a cast member without a current fenced account refuses only that entry', () => {
  const { f, self, facts, decide } = world();
  assert({
    given: 'the peer account missing from the fenced dependency set',
    should: 'omit the entry rather than refuse the whole inbox',
    actual: decide().entries(
      facts([entry(f.channel)], {
        accounts: new Map([[self.account.actorId, self]]),
      }),
    ),
    expected: [],
  });
});

test('a pending group invitation previews through its own minimal capability', () => {
  const { self, peer, facts, decide } = world();
  const [low, high] = [self.account.actorId, peer.account.actorId].sort() as [
    string,
    string,
  ];
  const groupId = 'g'.repeat(24);
  const invitation = {
    kind: 'group_invitation' as const,
    channel: {
      channelId: groupId,
      kind: 'private_group' as const,
      policyKey: 'social.private_group' as const,
      policyRevision: 1,
      revision: 2,
      lifecycle: 'active' as const,
      activeMemberActorIds: [peer.account.actorId],
    },
    invitation: {
      channelId: groupId,
      inviterActorId: peer.account.actorId,
      inviteeActorId: self.account.actorId,
      generation: 1,
      state: 'pending' as const,
    },
    inviterGrant: {
      actorId: peer.account.actorId,
      role: 'manager' as const,
      generation: 1,
    },
  };
  const pair = { lowActorId: low, highActorId: high, revision: 1 };
  const read = (present: boolean) =>
    decide().entries(
      facts([entry(null, { channelId: groupId, invitation })], {
        contactPairs: present ? [{ ...pair, blocked: false }] : [],
      }),
    );
  assert({
    given: 'an invitation with its inviter/invitee contact pair and without it',
    should:
      'preview only the invitation whose minimal pair facts are present, never through a history grant',
    actual: { present: read(true), absent: read(false) },
    expected: {
      present: [{ channelId: groupId, kind: 'incoming_invitation' }],
      absent: [],
    },
  });
});

test('the collection grant is checked on the caller account before any entry', async () => {
  const { self, decide } = world();
  await assertRejects({
    given: 'an erased caller account',
    should: 'refuse the inbox collection',
    actual: async () =>
      decide().collection({
        account: { ...self.account, erased: true, member: false },
        now: '2026-10-10T12:00:00.000Z',
      }),
    code: 'AUTHORIZATION',
  });
});
