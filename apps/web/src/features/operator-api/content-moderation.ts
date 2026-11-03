import {
  authorize,
  type AuthorizationPrincipal,
} from '@daisy/auth/authorization';
import type { OperatorCrypto } from '@daisy/auth/operator-signature';
import { createAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import {
  contentModerationCommands,
  contentReportDetailSchema,
  contentReportsCursorSchema,
  contentReportsPageSchema,
  contentReportsQuerySchema,
  type ContentModerationAction,
  type ContentModerationCommand,
  type ContentModerationCommandResult,
  type ContentModerationQueue,
  type ContentReport,
  type ContentReportDetail,
  type ContentReportsPage,
} from '@daisy/protocol/content-moderation';
import { operatorLimits } from '@daisy/protocol/operator';
import type { z } from 'zod';

/** One moderation change, named for what it does and carrying its own target. */
export type ContentModerationChange =
  | {
      readonly action: 'content_report.resolve';
      readonly reportId: string;
      readonly outcome: 'upheld' | 'dismissed';
    }
  | {
      readonly action: 'broadcast.stop';
      readonly broadcastId: string;
      readonly reason: ContentModerationCommand<'broadcast.stop'>['reason'];
    }
  | {
      readonly action: 'broadcast.chat_slow_mode.update';
      readonly broadcastId: string;
      readonly seconds: number;
    }
  | {
      readonly action: 'recording.takedown';
      readonly recordingId: string;
      readonly expectedVersion: number;
      readonly reason: ContentModerationCommand<'recording.takedown'>['reason'];
    }
  | {
      readonly action: 'recording.restore' | 'recording.remove';
      readonly recordingId: string;
      readonly expectedVersion: number;
    }
  | { readonly action: 'chat_message.remove'; readonly messageId: string }
  | {
      readonly action: 'account.audience_ban.update';
      readonly userId: string;
      readonly state: 'banned' | 'lifted';
    };

export type ContentModerationStore = {
  readonly listModerationReports: (input: {
    readonly queue: ContentModerationQueue;
    readonly status: ContentReport['status'];
    readonly limit: number;
    readonly after: {
      readonly reportedAt: string;
      readonly reportId: string;
    } | null;
  }) => Promise<readonly ContentReport[]>;
  readonly readModerationReport: (
    reportId: string,
  ) => Promise<ContentReportDetail | null>;
  /**
   * One transaction: the receipt first (the same digest replays, another
   * conflicts), then the change, then the commit deadline last (ADR 0079).
   */
  readonly runModerationCommand: (input: {
    readonly commandId: string;
    readonly serviceId: string;
    readonly operatorRef: string;
    readonly requestDigest: string;
    readonly adminAuditHead: string;
    readonly live: () => boolean;
    readonly change: ContentModerationChange;
  }) => Promise<ContentModerationCommandResult>;
};

type Deps = {
  readonly store: ContentModerationStore;
  readonly crypto: OperatorCrypto;
  readonly nowMs: () => number;
  readonly logger: Pick<Logger, 'log'>;
};

/** The operator routes moderation answers (WATCH-7, ADR 0079). */
export type ContentModerationRoute =
  | 'listContentReports'
  | 'readContentReport'
  | 'resolveContentReport'
  | 'stopBroadcast'
  | 'setChatSlowMode'
  | 'takeDownRecording'
  | 'restoreRecording'
  | 'removeRecording'
  | 'removeChatMessage'
  | 'setAudienceBan';

type OperatorPrincipal = Extract<
  AuthorizationPrincipal,
  { kind: 'operator_service' }
>;

const requireCapability = (
  principal: AuthorizationPrincipal,
  capability: ContentModerationAction | 'content_report.queue.read',
): OperatorPrincipal => {
  const decision = authorize({
    principal,
    capability,
    resource: { kind: 'content_moderation' },
    context: { account: null },
  });
  if (!decision.allow || principal.kind !== 'operator_service')
    throw createAppError('AUTHORIZATION');
  return principal;
};

const parsedBody = <S extends z.ZodType>(
  schema: S,
  body: Uint8Array,
): z.infer<S> => {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw createAppError('VALIDATION');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw createAppError('VALIDATION');
  return parsed.data;
};

const cursorOf = (value: string | undefined) => {
  if (value === undefined) return null;
  try {
    return contentReportsCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
  } catch {
    throw createAppError('VALIDATION');
  }
};

const commandOf = {
  resolveContentReport: (
    id: string,
    body: Uint8Array,
  ): ContentModerationChange => ({
    action: 'content_report.resolve',
    reportId: id,
    outcome: parsedBody(
      contentModerationCommands['content_report.resolve'],
      body,
    ).outcome,
  }),
  stopBroadcast: (id: string, body: Uint8Array): ContentModerationChange => ({
    action: 'broadcast.stop',
    broadcastId: id,
    reason: parsedBody(contentModerationCommands['broadcast.stop'], body)
      .reason,
  }),
  setChatSlowMode: (id: string, body: Uint8Array): ContentModerationChange => ({
    action: 'broadcast.chat_slow_mode.update',
    broadcastId: id,
    seconds: parsedBody(
      contentModerationCommands['broadcast.chat_slow_mode.update'],
      body,
    ).seconds,
  }),
  takeDownRecording: (
    id: string,
    body: Uint8Array,
  ): ContentModerationChange => {
    const { reason, expectedVersion } = parsedBody(
      contentModerationCommands['recording.takedown'],
      body,
    );
    return {
      action: 'recording.takedown',
      recordingId: id,
      expectedVersion,
      reason,
    };
  },
  restoreRecording: (
    id: string,
    body: Uint8Array,
  ): ContentModerationChange => ({
    action: 'recording.restore',
    recordingId: id,
    expectedVersion: parsedBody(
      contentModerationCommands['recording.restore'],
      body,
    ).expectedVersion,
  }),
  removeRecording: (id: string, body: Uint8Array): ContentModerationChange => ({
    action: 'recording.remove',
    recordingId: id,
    expectedVersion: parsedBody(
      contentModerationCommands['recording.remove'],
      body,
    ).expectedVersion,
  }),
  removeChatMessage: (id: string): ContentModerationChange => ({
    action: 'chat_message.remove',
    messageId: id,
  }),
  setAudienceBan: (id: string, body: Uint8Array): ContentModerationChange => ({
    action: 'account.audience_ban.update',
    userId: id,
    state: parsedBody(
      contentModerationCommands['account.audience_ban.update'],
      body,
    ).state,
  }),
} as const;

/** Every command carries the same transport fields, whatever else it says. */
const envelopeOf = (action: ContentModerationAction, body: Uint8Array) =>
  parsedBody(contentModerationCommands[action], body);

async function listReports(
  deps: Deps,
  principal: AuthorizationPrincipal,
  url: URL,
): Promise<ContentReportsPage> {
  requireCapability(principal, 'content_report.queue.read');
  const query = contentReportsQuerySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!query.success) throw createAppError('VALIDATION');
  const { queue, status, limit } = query.data;
  const cursor = cursorOf(query.data.cursor);
  if (cursor && (cursor.queue !== queue || cursor.status !== status))
    throw createAppError('VALIDATION');
  const rows = await deps.store.listModerationReports({
    queue,
    status,
    limit: limit + 1,
    after: cursor && {
      reportedAt: cursor.reportedAt,
      reportId: cursor.reportId,
    },
  });
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return contentReportsPageSchema.parse({
    items,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              v: 1,
              queue,
              status,
              reportedAt: last.reportedAt,
              reportId: last.reportId,
            }),
            'utf8',
          ).toString('base64url')
        : null,
  });
}

async function readReport(
  deps: Deps,
  principal: AuthorizationPrincipal,
  reportId: string,
): Promise<ContentReportDetail> {
  requireCapability(principal, 'content_report.queue.read');
  const report = await deps.store.readModerationReport(reportId);
  if (!report) throw createAppError('NOT_FOUND');
  return contentReportDetailSchema.parse(report);
}

async function runCommand(
  deps: Deps,
  principal: AuthorizationPrincipal,
  change: ContentModerationChange,
  body: Uint8Array,
  signedAtMs: number,
): Promise<ContentModerationCommandResult> {
  const operator = requireCapability(principal, change.action);
  const envelope = envelopeOf(change.action, body);
  const result = await deps.store.runModerationCommand({
    commandId: envelope.commandId,
    serviceId: operator.serviceId,
    operatorRef: operator.operatorRef,
    // The change is the semantic identity; transport fields stay out of it.
    requestDigest: deps.crypto.sha3Hex(
      JSON.stringify([operator.serviceId, operator.operatorRef, change]),
    ),
    adminAuditHead: envelope.adminAuditHead,
    live: () => deps.nowMs() <= signedAtMs + operatorLimits.skewMs,
    change,
  });
  deps.logger.log(
    'operator.command.applied',
    {
      operation: 'operator.moderation',
      requestId: envelope.commandId,
      cause: `${change.action}:${result.outcome}`,
    },
    'Operator moderation command applied',
  );
  return result;
}

/** Answers one moderation route; the router has already authenticated it. */
export function contentModerationRoute(
  deps: Deps,
  principal: AuthorizationPrincipal,
  route: ContentModerationRoute,
  id: string | null,
  url: URL,
  request: { readonly body: Uint8Array; readonly signedAtMs: number },
): Promise<unknown> {
  switch (route) {
    case 'listContentReports':
      return listReports(deps, principal, url);
    case 'readContentReport':
      return readReport(deps, principal, id!);
    default:
      return runCommand(
        deps,
        principal,
        commandOf[route](id!, request.body),
        request.body,
        request.signedAtMs,
      );
  }
}
