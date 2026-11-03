import {
  contentModerationQueues,
  contentReportStatuses,
  type ContentModerationQueue,
  type ContentReport,
} from '@daisy/protocol/content-moderation';
import { z } from 'zod';
import {
  contentModerationNotices,
  type ContentModerationNotice,
} from './actions';

type Status = ContentReport['status'];

const one = (value: unknown) => (typeof value === 'string' ? value : undefined);
const queueSchema = z.enum(contentModerationQueues).catch('safety');
const statusSchema = z.enum(contentReportStatuses).catch('open');
const noticeSchema = z.enum(contentModerationNotices).nullable().catch(null);
const cursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,256}$/)
  .optional()
  .catch(undefined);

/** The queue's URL state: anything outside the closed sets is dropped. */
export function contentModerationQuery(
  params: Readonly<Record<string, unknown>>,
): {
  readonly queue: ContentModerationQueue;
  readonly status: Status;
  readonly cursor: string | undefined;
  readonly notice: ContentModerationNotice | null;
} {
  return {
    queue: queueSchema.parse(one(params.queue)),
    status: statusSchema.parse(one(params.status)),
    cursor: cursorSchema.parse(one(params.cursor)),
    notice: noticeSchema.parse(one(params.notice) ?? null),
  };
}

export function contentModerationHref(state: {
  readonly queue: ContentModerationQueue;
  readonly status: Status;
  readonly cursor?: string;
}): string {
  const query = new URLSearchParams({
    queue: state.queue,
    status: state.status,
  });
  if (state.cursor) query.set('cursor', state.cursor);
  return `/content-moderation?${query.toString()}`;
}

const notices: Readonly<Record<ContentModerationNotice, string>> = {
  applied: 'Done.',
  unchanged: 'Already in that state; nothing changed.',
  not_found: 'That is not there any more; nothing changed.',
  refused: 'The participant app refused the command; nothing was changed.',
  unknown:
    'The outcome is not known yet. Submitting the same form again is safe.',
  denied: 'Your operator role does not permit this action.',
  unconfigured: 'The operator API is not configured for this environment.',
};

export const contentModerationNoticeText = (notice: ContentModerationNotice) =>
  notices[notice];

export const queueLabels: Readonly<Record<ContentModerationQueue, string>> = {
  safety: 'Safety',
  review: 'Dispute and integrity review',
};
export const statusLabels: Readonly<Record<Status, string>> = {
  open: 'Open',
  upheld: 'Upheld',
  dismissed: 'Dismissed',
};
