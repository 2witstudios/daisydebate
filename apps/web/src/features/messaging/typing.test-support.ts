import {
  messagingTestPosting,
  messagingTestReading,
} from '@daisy/auth/testing';
import { accountAgeFact } from '@daisy/auth/account-age';
import type { MessagingChannelFact } from '@daisy/db/messaging-social';
import type { MessagingRuntimePolicy } from './composition';
import { typingAuthority } from './typing-authority';
export function typingWorld() {
  const now = '2026-10-10T12:00:00.000Z';
  const ids = ['a'.repeat(24), 'b'.repeat(24)];
  const channel: MessagingChannelFact = {
    kind: 'channel',
    channelId: 'c'.repeat(24),
    policyKey: 'social.dm',
    policyRevision: 1,
    lifecycle: 'active',
    revision: 2,
    authority: {
      kind: 'dm',
      lowActorId: ids[0]!,
      highActorId: ids[1]!,
      requestSenderActorId: ids[0]!,
      state: 'accepted',
      blocked: false,
      revision: 3,
    },
  };
  const accounts = ids.map((actorId, index) => {
    const account = {
      actorId,
      userId: (index ? 'v' : 'u').repeat(24),
      member: true,
      erased: false,
      revision: 4,
    };
    return {
      account,
      age: accountAgeFact({
        account,
        now,
        source: { birthMonth: '2000-01', revision: 5, recordedAt: now },
      }),
    };
  });
  const policy = messagingUnitPolicy();
  const channels = ids.map((actorId) => ({ actorId, fact: channel }));
  const authority = typingAuthority({ channels, accounts, policy, now });
  const leases = authority.flatMap((row) =>
    row.lease ? [{ ...row.lease, expiresAt: '2026-10-10T12:00:05.000Z' }] : [],
  );
  return { now, ids, channel, channels, accounts, policy, authority, leases };
}
/** Two feature-port suites consume the same explicit canonical isolated policy, never a default. */
export function messagingUnitPolicy(): MessagingRuntimePolicy {
  return {
    posting: messagingTestPosting,
    reading: messagingTestReading,
    bounds: { messageUnits: 100, pageItems: 20 },
    maxBodyBytes: 1024,
    editWindowMs: 1000,
    limits: {
      read: { max: 10, windowSeconds: 60 },
      actorSend: { max: 10, windowSeconds: 60 },
      channelSend: { max: 10, windowSeconds: 60 },
    },
  };
}
