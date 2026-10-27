import type { roomStatuses } from '@daisy/protocol';

/**
 * A Room's lifecycle in words, read the same on the Room page and in the
 * views that bring a member back to it.
 */
export const roomStatusLabels = {
  assembling: 'Setting up',
  ready: 'Ready to start',
  started: 'In progress',
  closed: 'Closed',
} as const satisfies Record<(typeof roomStatuses)[number], string>;
