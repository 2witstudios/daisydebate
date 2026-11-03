import type {
  ContentModerationAction,
  ContentModerationCommandResult,
} from '@daisy/protocol/content-moderation';
import type { OperatorCall } from '../operator-client/client';

/** What an operator asks for, each with its target and its closed value. */
export type ContentModerationRequest =
  | {
      readonly action: 'content_report.resolve';
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

const paths: Readonly<Record<ContentModerationAction, (id: string) => string>> =
  {
    'content_report.resolve': (id) =>
      `/operator/v1/content-reports/${id}/resolution`,
    'broadcast.stop': (id) => `/operator/v1/broadcasts/${id}/stop`,
    'broadcast.chat_slow_mode.update': (id) =>
      `/operator/v1/broadcasts/${id}/chat-slow-mode`,
    'recording.takedown': (id) => `/operator/v1/recordings/${id}/takedown`,
    'chat_message.remove': (id) => `/operator/v1/chat-messages/${id}/removal`,
    'account.audience_ban.update': (id) =>
      `/operator/v1/accounts/${id}/audience-ban`,
  };

/** Where a request goes, and the command body it signs. */
export function contentModerationCall(
  request: ContentModerationRequest,
  envelope: { readonly commandId: string; readonly adminAuditHead: string },
): { readonly path: string; readonly body: object } {
  const { action, targetId, ...value } = request;
  return {
    path: paths[action](targetId),
    body: { v: 1, ...envelope, ...value },
  };
}

export const contentModerationNotices = [
  'applied',
  'unchanged',
  'not_found',
  'refused',
  'unknown',
  'denied',
  'unconfigured',
] as const;
export type ContentModerationNotice = (typeof contentModerationNotices)[number];

/** How one call reads, closed: `unknown` is never shown as a failure. */
export function contentModerationNotice(
  call: OperatorCall<ContentModerationCommandResult>,
): ContentModerationNotice {
  if (call.kind === 'ok') return call.value.outcome;
  if (call.kind === 'unknown') return 'unknown';
  return call.code === 'NOT_FOUND' ? 'not_found' : 'refused';
}

/** The closed, non-personal outcome an audit row records. */
export const auditedModeration = (
  call: OperatorCall<ContentModerationCommandResult>,
): string =>
  call.kind === 'ok'
    ? call.value.outcome
    : call.kind === 'rejected'
      ? `rejected:${call.code}`
      : 'unknown';
