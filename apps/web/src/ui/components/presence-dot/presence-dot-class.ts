import type { MemberStatus as Presence } from '@daisy/protocol';

const base = 'inline-block size-presence-dot rounded-round border-2';

const fills: Readonly<Record<Presence, string>> = {
  online: 'border-surface bg-online',
  away: 'border-surface bg-gold',
  busy: 'border-surface bg-hue-clay',
  room: 'border-surface bg-hue-teal',
  round: 'border-surface bg-live',
  // Hollow, so offline never relies on telling one small colour from another.
  offline: 'border-ink-faint bg-surface',
};

/** Classes for a presence dot of a member's Social presence (S8). */
export const presenceDotClass = (presence: Presence): string =>
  `${base} ${fills[presence]}`;
