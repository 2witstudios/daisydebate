import { loadAccountPolicyFacts } from '@daisy/auth/account-policy-facts';
import { bindAuthorizationAgeFact } from '@daisy/db/account-age';
import type {
  ChannelObservationReads,
  RealtimeAuthorityReads,
} from '@daisy/db';
import { isAppError } from '@daisy/errors';
import {
  channelMessagesWindow,
  createChannelMessagesProjector,
  createMessagingCoreSchemas,
  messagingBetaLimits,
} from '@daisy/protocol';
import {
  decideChannelViewer,
  type RealtimeReadingPolicy,
} from '../authorization';
import type { PermitDecision } from './permits';
import type { ObservableResource } from './resources';

/** Every member sees the same fields of a channel's window: one partition. */
export const CHANNEL_MESSAGES_PARTITION = 'members';
const bounds = {
  messageUnits: messagingBetaLimits.messageUnits,
  pageItems: messagingBetaLimits.pageItems,
};

/**
 * Channel messages, the first observable resource (ADR 0089). Its header is
 * the stream's `change_version` (content) and the channel's
 * `authority_revision` (disclosure); its projector is the same mapper HTTP
 * history uses; its permits come from one shared-fenced cohort read per
 * channel per cycle, with every viewer's decision made by the same channel
 * policy the topic path uses.
 */
export function channelMessagesResource({
  owner,
  authority,
  clock,
  now,
  readingPolicy,
}: {
  /** Header and projection reads, present only on an eligible owner process. */
  readonly owner: {
    readonly headers: ChannelObservationReads;
    readonly projection: ChannelObservationReads;
  } | null;
  readonly authority: {
    readonly admission: RealtimeAuthorityReads;
    readonly renewal: RealtimeAuthorityReads;
  };
  readonly clock: { readonly now: () => string };
  /** Monotonic ms. */
  readonly now: () => number;
  readonly readingPolicy: RealtimeReadingPolicy;
}): ObservableResource {
  const project = createChannelMessagesProjector(bounds);
  const { historyResult } = createMessagingCoreSchemas(bounds);
  const deadline = (expiry: string) =>
    now() + Math.max(0, Date.parse(expiry) - Date.parse(clock.now()));
  const requireOwner = () => {
    if (!owner) throw new Error('Not an observation owner process');
    return owner;
  };
  return {
    kind: 'channel-messages',
    readHeaders: (ids) =>
      requireOwner().headers.readChannelObservationHeaders(ids),
    async project(id) {
      const window =
        await requireOwner().projection.readChannelObservationWindow(
          id,
          channelMessagesWindow.limit,
        );
      if (!window) return null;
      return {
        partition: CHANNEL_MESSAGES_PARTITION,
        disclosureRevision: window.disclosureRevision,
        contentRevision: window.contentRevision,
        body: project({
          channelId: id,
          changeVersion: window.contentRevision,
          records: window.records,
          ...channelMessagesWindow,
        }),
      };
    },
    parseBody: (body) => {
      const parsed = historyResult.safeParse(body);
      return parsed.success ? parsed.data : null;
    },
    async evaluatePermits({ id, principals, lane }) {
      const reads = authority[lane];
      try {
        return await reads.messagingChannelCohortAuthority(
          { channelId: id, viewers: principals },
          async ({ tx, accounts: current, factFor }) => {
            const accounts = await loadAccountPolicyFacts({
              accounts: current,
              now: clock.now(),
              readAgeFact: bindAuthorizationAgeFact(tx),
            });
            const decisions: PermitDecision[] = [];
            for (const principal of principals) {
              const fact = factFor(principal.actorId);
              const viewer = await decideChannelViewer({
                tx,
                fact,
                accounts,
                principal,
                readingPolicy,
                clock,
                deadline,
              });
              decisions.push(
                viewer
                  ? {
                      status: 'allowed',
                      partition: CHANNEL_MESSAGES_PARTITION,
                      disclosureRevision: fact.revision,
                      // The browser applies snapshots monotonically from its own
                      // server-rendered revision, so admission sets no floor.
                      minimumContentRevision: 0,
                      validUntil: viewer.validUntil,
                    }
                  : { status: 'denied' },
              );
            }
            return decisions;
          },
        );
      } catch (error) {
        if (isAppError(error) && error.code === 'NOT_FOUND')
          return principals.map(() => ({ status: 'denied' as const }));
        throw error;
      }
    },
  };
}
