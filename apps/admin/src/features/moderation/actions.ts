import type {
  ModerationAction,
  ModerationCommandResult,
} from '@daisy/protocol/moderation';
import type { OperatorCall } from '../operator-client/client';

/** What an operator asks for, each with its target and its closed value. */
export type ModerationRequest =
  | {
      readonly action: 'report.resolve';
      readonly targetId: string;
      readonly outcome: 'upheld' | 'dismissed';
    }
  | {
      readonly action: 'broadcast.stop';
      readonly targetId: string;
      readonly reason: string;
    }
  | {
      readonly action: 'broadcast.chat_slow_mode.update';
      readonly targetId: string;
      readonly seconds: number;
    }
  | {
      readonly action: 'recording.takedown';
      readonly targetId: string;
      readonly reason: string;
    }
  | { readonly action: 'chat_message.remove'; readonly targetId: string }
  | {
      readonly action: 'account.audience_ban.update';
      readonly targetId: string;
      readonly state: 'banned' | 'lifted';
    };

const paths: Readonly<Record<ModerationAction, (id: string) => string>> = {
  'report.resolve': (id) => `/operator/v1/reports/${id}/resolution`,
  'broadcast.stop': (id) => `/operator/v1/broadcasts/${id}/stop`,
  'broadcast.chat_slow_mode.update': (id) =>
    `/operator/v1/broadcasts/${id}/chat-slow-mode`,
  'recording.takedown': (id) => `/operator/v1/recordings/${id}/takedown`,
  'chat_message.remove': (id) => `/operator/v1/chat-messages/${id}/removal`,
  'account.audience_ban.update': (id) =>
    `/operator/v1/accounts/${id}/audience-ban`,
};

/** Where a request goes, and the command body it signs. */
export function moderationCall(
  request: ModerationRequest,
  envelope: { readonly commandId: string; readonly adminAuditHead: string },
): { readonly path: string; readonly body: object } {
  const { action, targetId, ...value } = request;
  return {
    path: paths[action](targetId),
    body: { v: 1, ...envelope, ...value },
  };
}

export const moderationNotices = [
  'applied',
  'unchanged',
  'not_found',
  'refused',
  'unknown',
  'denied',
  'unconfigured',
] as const;
export type ModerationNotice = (typeof moderationNotices)[number];

/** How one call reads, closed: `unknown` is never shown as a failure. */
export function moderationNotice(
  call: OperatorCall<ModerationCommandResult>,
): ModerationNotice {
  if (call.kind === 'ok') return call.value.outcome;
  if (call.kind === 'unknown') return 'unknown';
  return call.code === 'NOT_FOUND' ? 'not_found' : 'refused';
}

/** The closed, non-personal outcome an audit row records. */
export const auditedModeration = (
  call: OperatorCall<ModerationCommandResult>,
): string =>
  call.kind === 'ok'
    ? call.value.outcome
    : call.kind === 'rejected'
      ? `rejected:${call.code}`
      : 'unknown';
