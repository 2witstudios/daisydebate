import type {
  ChosenStatus,
  MemberStatus,
  PresenceActivity,
} from '@daisy/protocol';

/** Where a member's active Room has them (ADR 0070). */
export type Placement = 'room' | 'round' | null;

/**
 * What anyone sees of a member, the one rule (ADR 0098). Appearing offline or
 * holding no lease is offline, and nothing tells which. Being in a Round or a
 * room shows over a chosen status, then Busy; otherwise activity decides.
 */
export function displayStatus(input: {
  readonly chosen: ChosenStatus;
  readonly activity: PresenceActivity | null;
  readonly placement: Placement;
}): MemberStatus {
  if (input.chosen === 'offline' || input.activity === null) return 'offline';
  if (input.placement) return input.placement;
  if (input.chosen === 'busy') return 'busy';
  return input.activity === 'active' ? 'online' : 'away';
}

/** Whether a status counts as around: everything but offline. */
export const isAround = (status: MemberStatus): boolean => status !== 'offline';
