import {
  moderationQueues,
  reportStatuses,
  type ModerationQueue,
  type ModerationReport,
} from '@daisy/protocol/moderation';
import { z } from 'zod';
import { moderationNotices, type ModerationNotice } from './actions';

type Status = ModerationReport['status'];

const one = (value: unknown) => (typeof value === 'string' ? value : undefined);
const queueSchema = z.enum(moderationQueues).catch('safety');
const statusSchema = z.enum(reportStatuses).catch('open');
const noticeSchema = z.enum(moderationNotices).nullable().catch(null);
const cursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,256}$/)
  .optional()
  .catch(undefined);

/** The queue's URL state: anything outside the closed sets is dropped. */
export function moderationQuery(params: Readonly<Record<string, unknown>>): {
  readonly queue: ModerationQueue;
  readonly status: Status;
  readonly cursor: string | undefined;
  readonly notice: ModerationNotice | null;
} {
  return {
    queue: queueSchema.parse(one(params.queue)),
    status: statusSchema.parse(one(params.status)),
    cursor: cursorSchema.parse(one(params.cursor)),
    notice: noticeSchema.parse(one(params.notice) ?? null),
  };
}

export function moderationHref(state: {
  readonly queue: ModerationQueue;
  readonly status: Status;
  readonly cursor?: string;
}): string {
  const query = new URLSearchParams({
    queue: state.queue,
    status: state.status,
  });
  if (state.cursor) query.set('cursor', state.cursor);
  return `/moderation?${query.toString()}`;
}

const notices: Readonly<Record<ModerationNotice, string>> = {
  applied: 'Done.',
  unchanged: 'Already in that state; nothing changed.',
  not_found: 'That is not there any more; nothing changed.',
  refused: 'The participant app refused the command; nothing was changed.',
  unknown:
    'The outcome is not known yet. Submitting the same form again is safe.',
  denied: 'Your operator role does not permit this action.',
  unconfigured: 'The operator API is not configured for this environment.',
};

export const moderationNoticeText = (notice: ModerationNotice) =>
  notices[notice];

export const queueLabels: Readonly<Record<ModerationQueue, string>> = {
  safety: 'Safety',
  review: 'Dispute and integrity review',
};
export const statusLabels: Readonly<Record<Status, string>> = {
  open: 'Open',
  upheld: 'Upheld',
  dismissed: 'Dismissed',
};
