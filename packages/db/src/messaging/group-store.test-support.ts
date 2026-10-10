import type { MessagingChannelFact } from './social';
/** Durable wire facts shared by the actual creation and invitation store contract readers. */
export function groupStoreFacts() {
  const inviter = 'a'.repeat(24),
    invitee = 'b'.repeat(24),
    channelId = 'c'.repeat(24);
  const accounts = [inviter, invitee].map((actorId, i) => ({
    actorId,
    userId: (i ? 'v' : 'u').repeat(24),
    member: true,
    erased: false,
    revision: 1,
  }));
  const channel = (
    actorId: string,
    role: 'manager' | null,
    generation: number,
    revision = 1,
  ): MessagingChannelFact => ({
    kind: 'channel',
    channelId,
    policyKey: 'social.private_group',
    policyRevision: 1,
    lifecycle: 'active',
    revision,
    authority: {
      kind: 'private_group',
      actorId,
      role,
      generation,
      activeMemberActorIds: [inviter],
    },
  });
  const now = new Date('2026-10-09T18:00:00.000Z');
  const invitation = (state = 'pending', sender = inviter) => [
    channelId,
    'private_group',
    invitee,
    sender,
    3,
    state,
    now,
    null,
  ];
  return { inviter, invitee, channelId, accounts, channel, now, invitation };
}

/** Real driver responses for channel advancement and two recipient outbox inserts. */
export function groupWriteBellRows() {
  return [[], [], [[1, '9']], [], [], [[2, '9']], [], [[3, '9']], []];
}
export function groupWrittenBells(
  queries: readonly {
    readonly query: string;
    readonly params: readonly unknown[];
  }[],
) {
  return queries
    .filter((query) => query.query.startsWith('insert into "outbox"'))
    .map((query) =>
      query.params.find((value) => typeof value === 'object' && value !== null),
    );
}
