import {
  authorize,
  type AuthorizationPrincipal,
} from '@daisy/auth/authorization';
import type { OperatorCrypto } from '@daisy/auth/operator-signature';
import { createAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import {
  moderationCommands,
  moderationReportDetailSchema,
  moderationReportsCursorSchema,
  moderationReportsPageSchema,
  moderationReportsQuerySchema,
  type ModerationAction,
  type ModerationCommand,
  type ModerationCommandResult,
  type ModerationQueue,
  type ModerationReport,
  type ModerationReportDetail,
  type ModerationReportsPage,
} from '@daisy/protocol/moderation';
import { operatorLimits } from '@daisy/protocol/operator';
import type { z } from 'zod';

/** One moderation change, named for what it does and carrying its own target. */
export type ModerationChange =
  | {
      readonly action: 'report.resolve';
      readonly reportId: string;
      readonly outcome: 'upheld' | 'dismissed';
    }
  | {
      readonly action: 'broadcast.stop';
      readonly broadcastId: string;
      readonly reason: ModerationCommand<'broadcast.stop'>['reason'];
    }
  | {
      readonly action: 'broadcast.chat_slow_mode.update';
      readonly broadcastId: string;
      readonly seconds: number;
    }
  | {
      readonly action: 'recording.takedown';
      readonly recordingId: string;
      readonly reason: ModerationCommand<'recording.takedown'>['reason'];
    }
  | { readonly action: 'chat_message.remove'; readonly messageId: string }
  | {
      readonly action: 'account.audience_ban.update';
      readonly userId: string;
      readonly state: 'banned' | 'lifted';
    };

export type ModerationStore = {
  readonly listModerationReports: (input: {
    readonly queue: ModerationQueue;
    readonly status: ModerationReport['status'];
    readonly limit: number;
    readonly after: {
      readonly reportedAt: string;
      readonly reportId: string;
    } | null;
  }) => Promise<readonly ModerationReport[]>;
  readonly readModerationReport: (
    reportId: string,
  ) => Promise<ModerationReportDetail | null>;
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
    readonly change: ModerationChange;
  }) => Promise<ModerationCommandResult>;
};

type Deps = {
  readonly store: ModerationStore;
  readonly crypto: OperatorCrypto;
  readonly nowMs: () => number;
  readonly logger: Pick<Logger, 'log'>;
};

/** The operator routes moderation answers (WATCH-7, ADR 0079). */
export type ModerationRoute =
  | 'listReports'
  | 'readReport'
  | 'resolveReport'
  | 'stopBroadcast'
  | 'setChatSlowMode'
  | 'takeDownRecording'
  | 'removeChatMessage'
  | 'setAudienceBan';

type OperatorPrincipal = Extract<
  AuthorizationPrincipal,
  { kind: 'operator_service' }
>;

const requireCapability = (
  principal: AuthorizationPrincipal,
  capability: ModerationAction | 'report.queue.read',
): OperatorPrincipal => {
  const decision = authorize({
    principal,
    capability,
    resource: { kind: 'moderation' },
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
    return moderationReportsCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
  } catch {
    throw createAppError('VALIDATION');
  }
};

const commandOf = {
  resolveReport: (id: string, body: Uint8Array): ModerationChange => ({
    action: 'report.resolve',
    reportId: id,
    outcome: parsedBody(moderationCommands['report.resolve'], body).outcome,
  }),
  stopBroadcast: (id: string, body: Uint8Array): ModerationChange => ({
    action: 'broadcast.stop',
    broadcastId: id,
    reason: parsedBody(moderationCommands['broadcast.stop'], body).reason,
  }),
  setChatSlowMode: (id: string, body: Uint8Array): ModerationChange => ({
    action: 'broadcast.chat_slow_mode.update',
    broadcastId: id,
    seconds: parsedBody(
      moderationCommands['broadcast.chat_slow_mode.update'],
      body,
    ).seconds,
  }),
  takeDownRecording: (id: string, body: Uint8Array): ModerationChange => ({
    action: 'recording.takedown',
    recordingId: id,
    reason: parsedBody(moderationCommands['recording.takedown'], body).reason,
  }),
  removeChatMessage: (id: string): ModerationChange => ({
    action: 'chat_message.remove',
    messageId: id,
  }),
  setAudienceBan: (id: string, body: Uint8Array): ModerationChange => ({
    action: 'account.audience_ban.update',
    userId: id,
    state: parsedBody(moderationCommands['account.audience_ban.update'], body)
      .state,
  }),
} as const;

/** Every command carries the same transport fields, whatever else it says. */
const envelopeOf = (action: ModerationAction, body: Uint8Array) =>
  parsedBody(moderationCommands[action], body);

async function listReports(
  deps: Deps,
  principal: AuthorizationPrincipal,
  url: URL,
): Promise<ModerationReportsPage> {
  requireCapability(principal, 'report.queue.read');
  const query = moderationReportsQuerySchema.safeParse(
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
  return moderationReportsPageSchema.parse({
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
): Promise<ModerationReportDetail> {
  requireCapability(principal, 'report.queue.read');
  const report = await deps.store.readModerationReport(reportId);
  if (!report) throw createAppError('NOT_FOUND');
  return moderationReportDetailSchema.parse(report);
}

async function runCommand(
  deps: Deps,
  principal: AuthorizationPrincipal,
  change: ModerationChange,
  body: Uint8Array,
  signedAtMs: number,
): Promise<ModerationCommandResult> {
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
export function moderationRoute(
  deps: Deps,
  principal: AuthorizationPrincipal,
  route: ModerationRoute,
  id: string | null,
  url: URL,
  request: { readonly body: Uint8Array; readonly signedAtMs: number },
): Promise<unknown> {
  switch (route) {
    case 'listReports':
      return listReports(deps, principal, url);
    case 'readReport':
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
