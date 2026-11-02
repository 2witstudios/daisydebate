import type { Source } from './browser-transport';
import type { MediaConnectionState } from './media-controller';
import type { MediaFailureKind } from './media-failure';
import { hasLiveTracks } from './media-status';

/**
 * The actual publication state of one Round's local sources, reported by the
 * media session to its owner and passed to the Round controls as a named input.
 * Permission-to-speak stays the server's grant; this states what is actually
 * happening on this device (ISSUE-881).
 */
export type LocalPublication =
  'published' | 'muted' | 'ill' | 'disconnected' | 'absent' | null;

/**
 * Derives one behind the scenes: still recovering some source ("ill"),
 * merely muted for floor-turn reasons ("muted"), publishing ("published"),
 * or nothing captured at all ("absent").
 */
export function localPublicationOf(input: {
  readonly connection: MediaConnectionState;
  readonly failure: MediaFailureKind | null;
  readonly grants: readonly Source[] | undefined;
  readonly captured: readonly Source[] | undefined;
  readonly muted: boolean | undefined;
}): LocalPublication {
  // A released connection has no grants to read, and that is still a condition, not
  // unknown. Only while recovery is working on it is anything reconnecting.
  if (input.connection === 'reconnecting') return 'ill';
  if (input.connection === 'unavailable')
    return input.failure === 'transient' ? 'ill' : 'disconnected';
  if (!hasLiveTracks(input.connection)) return null;
  if (input.grants === undefined || input.captured === undefined) return null;
  if (
    input.muted &&
    input.grants.includes('microphone') &&
    input.captured.includes('microphone')
  )
    return 'muted';
  if (input.captured.includes('microphone')) return 'published';
  if (input.grants.includes('microphone')) return 'absent';
  return null;
}
