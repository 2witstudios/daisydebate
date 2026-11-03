import type { MemberStatus } from '@daisy/protocol';

/** The one set of words for a member's status. */
export const statusLabels: Readonly<Record<MemberStatus, string>> = {
  online: 'Online',
  away: 'Away',
  busy: 'Busy',
  room: 'In a room',
  round: 'In a round',
  offline: 'Offline',
};
