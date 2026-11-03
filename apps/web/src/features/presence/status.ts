import type {
  ChosenStatus,
  MemberStatus,
  PresenceActivity,
  MemberPlacement,
} from '@daisy/protocol';

/**
 * What anyone sees of a member, the one rule (ADR 0103). Appearing offline or
 * holding no lease is offline, and nothing tells which. Being in a Round or a
 * room shows over a chosen status, then Busy; otherwise activity decides.
 */
export function displayStatus(input: {
  readonly chosen: ChosenStatus;
  readonly activity: PresenceActivity | null;
  readonly placement: MemberPlacement;
}): MemberStatus {
  if (input.chosen === 'appearing_offline' || input.activity === null)
    return 'offline';
  if (input.placement) return input.placement;
  if (input.chosen === 'busy') return 'busy';
  return input.activity === 'active' ? 'online' : 'away';
}
