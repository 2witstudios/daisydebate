import {
  audienceReactionKinds,
  type AudienceReactionKind,
  type AudienceSnapshot,
} from '@daisy/protocol';

/** The audience's rows, as moderation left them. This module imports no adapter. */
export type AudienceSnapshotRead = {
  readonly hasBroadcast: boolean;
  readonly open: boolean;
  readonly messages: AudienceSnapshot['messages'];
  readonly reactions: readonly {
    readonly kind: string;
    readonly count: number;
  }[];
};

/** Every reaction kind in its order, with zero for one nobody has used. */
const reactionTotals = (
  read: AudienceSnapshotRead,
): AudienceSnapshot['reactions'] =>
  audienceReactionKinds.map((kind: AudienceReactionKind) => ({
    kind,
    count: read.reactions.find((row) => row.kind === kind)?.count ?? 0,
  }));

/** A zero count is no count: nothing to say. */
export const projectAudienceSnapshot = (
  roundId: string,
  read: AudienceSnapshotRead,
  viewers: number | null,
): AudienceSnapshot => ({
  version: 1,
  roundId,
  interaction: !read.hasBroadcast
    ? 'unavailable'
    : read.open
      ? 'open'
      : 'closed',
  messages: read.messages,
  reactions: reactionTotals(read),
  viewers: viewers === 0 ? null : viewers,
});
