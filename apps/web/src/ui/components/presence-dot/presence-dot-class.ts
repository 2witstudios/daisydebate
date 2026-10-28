import type { FriendPresence as Presence } from '@daisy/protocol';

const base =
  'inline-block size-presence-dot rounded-round border-2 border-surface';

const fills: Readonly<Record<Presence, string>> = {
  online: 'bg-online',
  away: 'bg-gold',
  offline: 'bg-ink-faint',
};

/** Classes for a presence dot of a member's Social presence (S8). */
export const presenceDotClass = (presence: Presence): string =>
  `${base} ${fills[presence]}`;
