import type { Source } from './browser-transport';

/**
 * The actual publication state of one Round's local sources, reported by the
 * media session and read as an explicit named input by the Round controls.
 * Permission-to-speak stays the server's grant; this states what is actually
 * happening on this device (ISSUE-881).
 */
export type LocalPublication = 'published' | 'muted' | 'ill' | 'absent' | null;

type Listener = () => void;
const publications = new Map<string, LocalPublication>();
const listeners = new Map<string, Set<Listener>>();

const notify = (roundId: string) => {
  for (const listener of listeners.get(roundId) ?? []) listener();
};

/** The media session reports after each real snapshot of its own tracks. */
export function reportLocalPublication(
  roundId: string,
  value: LocalPublication,
) {
  const previous = publications.get(roundId);
  if (previous === value) {
    return;
  }
  if (value === null) publications.delete(roundId);
  else publications.set(roundId, value);
  notify(roundId);
}

/** The controls subscribe; unmounting unsubscribes. */
export function subscribeLocalPublication(
  roundId: string,
  listener: Listener,
): () => void {
  const current = listeners.get(roundId) ?? new Set<Listener>();
  current.add(listener);
  listeners.set(roundId, current);
  return () => {
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(roundId);
    }
  };
}

/** Reads the current publication truth; absent reads null (a no-record). */
export function readLocalPublication(roundId: string): LocalPublication {
  return publications.get(roundId) ?? null;
}

/**
 * Derives one behind the scenes: still recovering some source ("ill"),
 * merely muted for floor-turn reasons ("muted"), publishing ("published"),
 * or nothing captured at all ("absent").
 */
export function localPublicationOf(input: {
  readonly connection: string | undefined;
  readonly grants: readonly Source[] | undefined;
  readonly captured: readonly Source[] | undefined;
  readonly muted: boolean | undefined;
}): LocalPublication {
  if (input.grants === undefined || input.captured === undefined) return null;
  if (input.connection !== 'live') return 'ill';
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
