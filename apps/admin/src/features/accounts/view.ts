import { z } from 'zod';
import { commandNotices, type CommandNotice } from './outcome';

/**
 * The accounts screen's URL state (no client script): the tab, the keyset
 * cursor and the notice a command redirects back with. Anything outside the
 * closed sets is dropped, never echoed.
 */
export const accessTabs = ['pending', 'approved', 'revoked'] as const;
export type AccessTab = (typeof accessTabs)[number];
type Mail = 'queued' | 'none';

const one = (value: unknown) => (typeof value === 'string' ? value : undefined);
const tabSchema = z.enum(accessTabs).catch('pending');
const noticeSchema = z.enum(commandNotices).nullable().catch(null);
const mailSchema = z.enum(['queued', 'none']).nullable().catch(null);
const cursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,256}$/)
  .optional()
  .catch(undefined);

export function accountsQuery(params: Readonly<Record<string, unknown>>): {
  readonly access: AccessTab;
  readonly cursor: string | undefined;
  readonly notice: CommandNotice | null;
  readonly mail: Mail | null;
} {
  return {
    access: tabSchema.parse(one(params.access)),
    cursor: cursorSchema.parse(one(params.cursor)),
    notice: noticeSchema.parse(one(params.notice) ?? null),
    mail: mailSchema.parse(one(params.mail) ?? null),
  };
}

export function accountsHref(state: {
  readonly access: AccessTab;
  readonly cursor?: string;
  readonly notice?: CommandNotice;
  readonly mail?: Mail | null;
}): string {
  const query = new URLSearchParams({ access: state.access });
  if (state.cursor) query.set('cursor', state.cursor);
  if (state.notice) query.set('notice', state.notice);
  if (state.mail) query.set('mail', state.mail);
  return `/accounts?${query.toString()}`;
}

const mailText = (mail: Mail | null) =>
  mail === 'queued'
    ? ' Approval email queued.'
    : mail === 'none'
      ? ' No email sent.'
      : '';

const notices: Readonly<Record<CommandNotice, string>> = {
  changed: 'Done.',
  unchanged: 'Already in that state; nothing changed.',
  conflict:
    'The account changed since this page loaded. Its current state is shown below; nothing was changed.',
  refused: 'The participant app refused the command; nothing was changed.',
  unknown:
    'The outcome is not known yet. It will be reconciled; do not repeat the action.',
  denied: 'Your operator role does not permit this action.',
  reconciled: 'Open commands were reconciled.',
  unconfigured: 'The operator API is not configured for this environment.',
};

export const noticeText = (notice: CommandNotice, mail: Mail | null) =>
  `${notices[notice]}${mailText(mail)}`;
