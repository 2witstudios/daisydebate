import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildChannelTopic } from '@daisy/protocol';
import type { ChannelAuthorizationFact } from '@daisy/auth/authorization';
import type { RealtimeApp } from './app';
import {
  createRealtimeAuthorization,
  type RealtimeReadingPolicy,
} from './authorization';

setupRitewayBun();
const principal = {
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  sessionId: 's'.repeat(24),
};
const account = { ...principal, member: true, erased: false, revision: 2 };
const peer = {
  userId: 'v'.repeat(24),
  actorId: 'b'.repeat(24),
  member: true,
  erased: false,
  revision: 3,
};
const fact: ChannelAuthorizationFact = {
  kind: 'channel',
  channelId: 'c'.repeat(24),
  policyKey: 'social.dm',
  policyRevision: 1,
  lifecycle: 'active',
  revision: 4,
  authority: {
    kind: 'dm',
    lowActorId: principal.actorId,
    highActorId: peer.actorId,
    requestSenderActorId: principal.actorId,
    state: 'accepted',
    blocked: false,
    revision: 5,
  },
};
// Explicit fixture evidence, never a production policy default or activation.
const approvedTestReading: RealtimeReadingPolicy = ({
  channel,
  accounts,
  now,
}) => ({
  channelId: channel.channelId,
  policyKey: channel.policyKey,
  policyRevision: channel.policyRevision,
  authorityRevision: channel.revision,
  relationshipRevision: 5,
  allowed: true,
  evaluatedAt: now,
  validUntil: '2026-10-09T00:00:30.000Z',
  accounts: accounts.map(({ account: row, age }) => ({
    actorId: row.actorId!,
    userId: row.userId,
    accountRevision: row.revision,
    ageRevision: age.state === 'known' ? age.revision : null,
  })),
});
for (const mode of [
  'approved-test',
  'missing-policy',
  'expired-session',
  'changed-account',
] as const)
  test(`minimal channel authority composition ${mode}`, async () => {
    let instant = '2026-10-09T00:00:00.000Z';
    let calls = 0,
      frames = 0;
    const expiry = '2026-10-09T00:00:01.000Z';
    const tx = {
      execute: async () => {
        calls += 1;
        if (calls <= 2) return []; // Unknown minimal age facts are not an eligibility grant.
        if (calls === 3) {
          if (mode === 'expired-session') instant = expiry;
          return [{ userId: principal.userId, expiresAt: new Date(expiry) }];
        }
        return [
          {
            ...account,
            revision: mode === 'changed-account' ? 9 : account.revision,
          },
        ];
      },
    };
    const resources = {
      clock: { now: () => instant },
      database: {
        readAuthorizationSession: async () => ({
          ...principal,
          account,
          expiresAt: expiry,
        }),
        messagingChannelAuthority: async (
          input: unknown,
          work: (frame: unknown) => Promise<unknown>,
        ) => {
          frames += 1;
          assert({
            given: 'the public minimal authority port',
            should: 'receive the exact principal and channel',
            actual: input,
            expected: { ...principal, channelId: fact.channelId },
          });
          return work({ tx, fact, accounts: [account, peer] });
        },
      },
    } as unknown as RealtimeApp;
    const auth = createRealtimeAuthorization({
      resources,
      now: () => Date.parse(instant),
      ...(mode === 'missing-policy'
        ? {}
        : { readingPolicy: approvedTestReading }),
    });
    const result = await auth.authorizeTopic(
      principal,
      buildChannelTopic(fact.channelId),
    );
    assert({
      given:
        'same-transaction minimal age/session/account facts and explicit test-only evidence',
      should:
        'bind current facts and preserve session expiry, otherwise refuse',
      actual: { frames, queries: calls, deadline: result?.validUntil ?? null },
      expected: {
        frames: 1,
        queries: 4,
        deadline: mode === 'approved-test' ? Date.parse(expiry) : null,
      },
    });
  });
