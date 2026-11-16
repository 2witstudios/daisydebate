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
      readonly expectedVersion: number;
      readonly reason: string;
    }
  | {
      readonly action: 'recording.legal_remove';
      readonly targetId: string;
      readonly expectedVersion: number;
      readonly reason: string;
    }
  | {
      readonly action:
        'recording.restore' | 'recording.remove' | 'recording.rebuild';
      readonly targetId: string;
      readonly expectedVersion: number;
    }
  | { readonly action: 'chat_message.remove'; readonly targetId: string }
  | {
      readonly action: 'profile_photo.review';
      readonly targetId: string;
      readonly expectedVersion: number;
      readonly outcome: 'approve' | 'reject';
    }
  | {
      readonly action: 'profile_photo.remove';
      readonly targetId: string;
      readonly expectedVersion: number;
      readonly reason: string;
    }
  | {
      readonly action: 'profile_text.remove';
      readonly targetId: string;
      readonly expectedVersion: number;
      readonly field: 'display_name' | 'bio';
      readonly reason: string;
    }
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
    'recording.restore': (id) => `/operator/v1/recordings/${id}/restoration`,
    'recording.remove': (id) => `/operator/v1/recordings/${id}/removal`,
    'recording.legal_remove': (id) =>
      `/operator/v1/recordings/${id}/legal-removal`,
    'recording.rebuild': (id) => `/operator/v1/recordings/${id}/rebuild`,
    'chat_message.remove': (id) => `/operator/v1/chat-messages/${id}/removal`,
    'profile_photo.review': (id) => `/operator/v1/profile-photos/${id}/review`,
    'profile_photo.remove': (id) => `/operator/v1/profile-photos/${id}/removal`,
    'profile_text.remove': (id) => `/operator/v1/profiles/${id}/text-removal`,
    'account.audience_ban.update': (id) =>
      `/operator/v1/accounts/${id}/audience-ban`,
  };

/** The closed value an intent records beyond its target, if any. */
function auditedValue(request: ContentModerationRequest): string | null {
  switch (request.action) {
    case 'recording.legal_remove':
    case 'profile_photo.remove':
      return request.reason;
    case 'profile_photo.review':
      return request.outcome;
    case 'profile_text.remove':
      return `${request.field}:${request.reason}`;
    case 'content_report.resolve':
    case 'broadcast.stop':
    case 'broadcast.chat_slow_mode.update':
    case 'recording.takedown':
    case 'recording.restore':
    case 'recording.remove':
    case 'recording.rebuild':
    case 'chat_message.remove':
    case 'account.audience_ban.update':
      return null;
  }
}

/**
 * What the audit chain records before a command is signed: the action and its target
 * id, closed, naming no person's content. A legal removal outruns every hold, so its
 * closed legal ground is on the record too. A photo review records which way it
 * went. A profile removal records its closed reason (ADR 0143), and a text removal
 * also which field it cleared: one target, two different acts.
 */
export const auditedIntent = (request: ContentModerationRequest): string => {
  const value = auditedValue(request);
  return value === null
    ? `${request.action}:${request.targetId}`
    : `${request.action}:${request.targetId}:${value}`;
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
