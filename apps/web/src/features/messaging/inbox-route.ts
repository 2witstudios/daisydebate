import { consumeBadgeRead, consumeMessagingRead } from './handler-boundary';
import type { App } from '../../server/app';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import {
  createMessagingInboxSchemas,
  messagingUnreadSchema,
} from '@daisy/protocol/messaging/inbox';
import { idSchema } from '@daisy/protocol/primitives';
import { createAppError } from '@daisy/errors';
import { parseValidated } from '../../server/http';

import { composeMessagingInbox } from './inbox-composition';
import { unreadConversationsOf } from './inbox-view';
import { requireMemberActor } from '../access/actor';
import { memberHttpBoundary, runEvaluatedRoute } from '../auth/member-boundary';
const inboxOf = (app: App, principal: AuthorizationPrincipal) =>
  composeMessagingInbox({
    database: app.database,
    principal,
    clock: app.clock,
    postingPolicy: app.messagingPolicy.posting,
    readingPolicy: app.messagingPolicy.reading,
  });

/** One conversation's inbox entry: its title and kind for its page (ISSUE-605). */
export function composeMessagingChannelEntryRoute(app: App) {
  return (request: Request, channelId: string) => {
    const schemas = createMessagingInboxSchemas(
      app.messagingPolicy.bounds.pageItems,
    );
    return runEvaluatedRoute(memberHttpBoundary(app), request, {
      name: 'messaging.channel.entry',
      readOnly: true,
      readInput: async () => parseValidated(idSchema, channelId),
      operation: async (value, principal) => {
        await consumeMessagingRead(app, requireMemberActor(principal).actorId);
        return schemas.entry.parse({
          version: 1,
          entry: await inboxOf(app, principal).entry(
            parseValidated(idSchema, value),
          ),
        });
      },
    });
  };
}

export function composeMessagingInboxRoute(app: App) {
  return (request: Request) => {
    const policy = app.messagingPolicy;
    const schemas = createMessagingInboxSchemas(policy.bounds.pageItems);
    return runEvaluatedRoute(memberHttpBoundary(app), request, {
      name: 'messaging.inbox',
      readOnly: true,
      headers: {
        'x-messaging-page-items': String(policy.bounds.pageItems),
        ...(app.websocketEndpoint
          ? { 'x-realtime-socket-url': app.websocketEndpoint }
          : {}),
      },
      readInput: async () => {
        const params = new URL(request.url).searchParams;
        if (
          [...params.keys()].some((key) => key !== 'after' && key !== 'q') ||
          params.getAll('after').length > 1 ||
          params.getAll('q').length > 1
        )
          throw createAppError('VALIDATION');
        const after = params.get('after');
        const q = params.get('q');
        return parseValidated(schemas.query, {
          version: 1,
          ...(after === null ? {} : { after }),
          ...(q === null ? {} : { q }),
        });
      },
      operation: async (value, principal) => {
        const query = parseValidated(schemas.query, value);
        await consumeMessagingRead(app, requireMemberActor(principal).actorId);
        const result = await inboxOf(app, principal).read({
          limit: policy.bounds.pageItems,
          ...(query.after === undefined ? {} : { after: query.after }),
          ...(query.q === undefined ? {} : { search: query.q }),
        });
        return schemas.result.parse({ version: 1, ...result });
      },
    });
  };
}

/** The most conversations the badge reads: it says at most "9+". */
const MESSAGES_BADGE_PAGE = 10;

/**
 * GET /api/messaging/unread (ADR 0144): how many of the member's newest
 * conversations wait on them, for the Messages badge, under the same
 * fresh authority as the inbox itself.
 */
export function composeMessagingUnreadRoute(app: App) {
  return (request: Request) =>
    runEvaluatedRoute(memberHttpBoundary(app), request, {
      name: 'messaging.unread',
      readOnly: true,
      headers: { 'cache-control': 'no-store' },
      readInput: async () => null,
      operation: async (_input, principal) => {
        await consumeBadgeRead(app, requireMemberActor(principal).actorId);
        const { entries } = await inboxOf(app, principal).read({
          // The badge shows up to "9+": ten entries answer it.
          limit: Math.min(
            MESSAGES_BADGE_PAGE,
            app.messagingPolicy.bounds.pageItems,
          ),
        });
        return messagingUnreadSchema.parse({
          version: 1,
          unread: unreadConversationsOf(entries),
        });
      },
    });
}
