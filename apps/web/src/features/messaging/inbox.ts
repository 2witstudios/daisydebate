import type {
  MessagingInboxCandidate,
  MessagingInboxPage,
  MessagingInboxPolicy,
  MessagingInboxSummary,
} from '@daisy/db/messaging';
import { loadAccountPolicyFacts } from '@daisy/auth/account-policy-facts';
import { requireAuthorization } from '@daisy/auth/request-authorization';
import { isAppError } from '@daisy/errors';
import { requireMemberActor } from '../access/actor';
import {
  messagingAuthorizationInput,
  type MessagingFenceOptions,
} from './authorization-fence';
import { groupInvitationAuthorizationInput } from './group-invitation-composition';
import {
  messagingInboxPreviewMax,
  messagingInboxTitleMax,
} from '@daisy/protocol';
type SummarizedKind =
  | 'conversation'
  | 'group_conversation'
  | 'incoming_request'
  | 'outgoing_request';
export type MessagingInboxEntry =
  | {
      readonly channelId: string;
      readonly kind: SummarizedKind;
      readonly title: string | null;
      readonly preview: {
        readonly text: string;
        readonly fromSelf: boolean;
      } | null;
      readonly activityAt: string;
      readonly unread: boolean;
    }
  | { readonly channelId: string; readonly kind: 'incoming_invitation' };

type InboxAuthority =
  | {
      readonly kind: 'dm';
      readonly state: string;
      readonly requestSenderActorId: string;
      readonly lowActorId: string;
      readonly highActorId: string;
    }
  | { readonly kind: 'private_group' };

/** How a reader's own grant on a channel projects into the inbox. */
export function messagingInboxView(authority: InboxAuthority, actorId: string) {
  if (authority.kind === 'private_group')
    return {
      kind: 'group_conversation',
      capability: 'channel.read',
      counterpartActorId: null,
      content: 'messages',
    } as const;
  const counterpartActorId =
    authority.lowActorId === actorId
      ? authority.highActorId
      : authority.lowActorId;
  if (authority.state !== 'pending')
    return {
      kind: 'conversation',
      capability: 'channel.read',
      counterpartActorId,
      content: 'messages',
    } as const;
  const sender = authority.requestSenderActorId === actorId;
  return {
    kind: sender ? 'outgoing_request' : 'incoming_request',
    capability: sender ? 'channel.request.status' : 'channel.request.read',
    counterpartActorId,
    content: 'introduction',
  } as const;
}

/** One line of at most `max` UTF-16 units, cut on code points with an ellipsis. */
export function messagingInboxExcerpt(
  text: string,
  max = messagingInboxPreviewMax,
): string | null {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line === '') return null;
  if (line.length <= max) return line;
  let excerpt = '';
  for (const point of line) {
    if (excerpt.length + point.length > max - 1) break;
    excerpt += point;
  }
  return `${excerpt.trimEnd()}…`;
}

/** The newest message, else the request introduction, as a bounded line. */
function previewOf(summary: MessagingInboxSummary) {
  const source = summary.lastMessage ?? summary.introduction;
  const text = source?.text ? messagingInboxExcerpt(source.text) : null;
  return source && text !== null ? { text, fromSelf: source.fromSelf } : null;
}

export function summarizeMessagingInboxEntry(
  channelId: string,
  kind: SummarizedKind,
  summary: MessagingInboxSummary,
): Extract<MessagingInboxEntry, { readonly kind: SummarizedKind }> {
  return {
    channelId,
    kind,
    title:
      summary.title === null
        ? null
        : messagingInboxExcerpt(summary.title, messagingInboxTitleMax),
    preview: previewOf(summary),
    activityAt:
      summary.lastMessage?.createdAt ??
      summary.introduction?.requestedAt ??
      summary.createdAt,
    unread: summary.unread,
  };
}

/** Invitations await a decision, so they lead; then newest activity first. */
const byAttention = (a: MessagingInboxEntry, b: MessagingInboxEntry) =>
  a.kind === 'incoming_invitation' || b.kind === 'incoming_invitation'
    ? Number(b.kind === 'incoming_invitation') -
      Number(a.kind === 'incoming_invitation')
    : b.activityAt.localeCompare(a.activityAt);
type InboxDecision = {
  readonly kind: MessagingInboxEntry['kind'];
  readonly summary: {
    readonly counterpartActorId: string | null;
    readonly content: 'messages' | 'introduction';
  } | null;
};
const refused = (error: unknown, codes: readonly string[]) => {
  if (!isAppError(error) || !codes.includes(error.code)) throw error;
  return null;
};
/**
 * One candidate's entry under the reader's own channel grant, else a distinct
 * minimal invitation grant, else nothing. Pure over the page's fenced facts;
 * outages are never read as an omitted entry.
 */
export async function decideMessagingInboxCandidate(
  candidate: MessagingInboxCandidate,
  ageOf: Parameters<MessagingInboxPolicy<InboxDecision>['decide']>[1],
  options: MessagingFenceOptions & { readonly now: string },
): Promise<InboxDecision | null> {
  const { principal, now } = options;
  const scope = {
    ...requireMemberActor(principal),
    channelId: candidate.channelId,
  };
  if (candidate.channel)
    try {
      const { fact } = candidate.channel;
      const view = messagingInboxView(fact.authority, scope.actorId);
      const accounts = await loadAccountPolicyFacts({
        accounts: candidate.channel.accounts,
        now,
        readAgeFact: async (account) => ageOf(account),
      });
      requireAuthorization({
        ...messagingAuthorizationInput(scope, fact, { accounts, now }, options),
        capability: view.capability,
      });
      return {
        kind: view.kind,
        summary: {
          counterpartActorId: view.counterpartActorId,
          content: view.content,
        },
      };
    } catch (error) {
      refused(error, ['AUTHORIZATION', 'NOT_FOUND']);
    }
  if (!candidate.invitation) return null;
  try {
    requireAuthorization(
      groupInvitationAuthorizationInput({
        principal,
        scope,
        operation: 'read',
        facts: {
          invitation: candidate.invitation.fact,
          accounts: candidate.invitation.accounts,
        },
        now,
      }),
    );
    return { kind: 'incoming_invitation', summary: null };
  } catch (error) {
    return refused(error, ['AUTHORIZATION', 'NOT_FOUND', 'CONFLICT']);
  }
}

/** The page's DTOs: invitations lead, then newest activity first. */
export function messagingInboxEntries(
  page: MessagingInboxPage<InboxDecision>['entries'],
): MessagingInboxEntry[] {
  return page
    .flatMap(({ channelId, decision, summary }): MessagingInboxEntry[] => {
      if (decision.kind === 'incoming_invitation')
        return [{ channelId, kind: 'incoming_invitation' }];
      return summary
        ? [summarizeMessagingInboxEntry(channelId, decision.kind, summary)]
        : [];
    })
    .sort(byAttention);
}
