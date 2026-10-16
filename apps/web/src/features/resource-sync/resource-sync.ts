/**
 * Whether the held value is known current, kept after a failed read
 * (`stale`), or for a resource that no longer reads (`gone`).
 */
export type Freshness = 'current' | 'stale' | 'gone';

/** A server resource as the browser holds it between reads (ADR 0066). */
export type ResourceSync<T> = {
  readonly value: T;
  /** Monotonic milliseconds of the read that produced `value`. */
  readonly readAt: number;
  readonly freshness: Freshness;
  readonly reading: boolean;
  /** Another read is wanted once nothing is in flight. */
  readonly due: boolean;
  /** The highest version a doorbell has announced. */
  readonly announced: number;
};

export type ResourceEvent<T> =
  /** A doorbell's version, or null for any other reason to look. */
  | { readonly type: 'signal'; readonly version: number | null }
  | { readonly type: 'read' }
  | { readonly type: 'found'; readonly value: T; readonly at: number }
  | { readonly type: 'unavailable' }
  | { readonly type: 'missing' }
  /** A command's canonical answer. */
  | { readonly type: 'accepted'; readonly value: T; readonly at: number };

/** How a resource's values are told apart and ordered. */
export type ResourceIdentity<T> = {
  readonly id: (value: T) => string;
  /** Increases with every change the server records. */
  readonly version: (value: T) => number;
  /**
   * The value to hold when a read returns the version already held: its
   * time-derived fields may still have moved. Defaults to the new value.
   */
  readonly sameVersion?: (held: T, next: T) => T;
};

export function seedResourceSync<T>(
  identity: ResourceIdentity<T>,
  value: T,
  at: number,
): ResourceSync<T> {
  return {
    value,
    readAt: at,
    freshness: 'current',
    reading: false,
    due: false,
    announced: identity.version(value),
  };
}

/**
 * The pure transition of a synced resource. A value older than the one held
 * is never adopted, so an out-of-order answer cannot roll the resource back.
 * Reads are single-flight with at most one more due. A failed read keeps the
 * held value as stale and schedules nothing: the caller's backstop paces
 * retries, so an outage is never a read loop.
 */
export function resourceSync<T>(identity: ResourceIdentity<T>) {
  const adopt = (
    state: ResourceSync<T>,
    next: T,
    at: number,
  ): ResourceSync<T> => {
    const held = identity.version(state.value);
    const version = identity.version(next);
    if (version < held) return state;
    return {
      ...state,
      value:
        version === held && identity.sameVersion
          ? identity.sameVersion(state.value, next)
          : next,
      readAt: at,
      freshness: 'current',
    };
  };
  const ours = (state: ResourceSync<T>, value: T) =>
    identity.id(value) === identity.id(state.value);
  const signalled = (
    state: ResourceSync<T>,
    version: number | null,
  ): ResourceSync<T> => {
    const covered =
      version !== null && version <= identity.version(state.value);
    if (state.freshness === 'gone' || covered) return state;
    return {
      ...state,
      due: true,
      announced: Math.max(state.announced, version ?? 0),
    };
  };
  const unavailable = (state: ResourceSync<T>): ResourceSync<T> => ({
    ...state,
    reading: false,
    freshness: state.freshness === 'gone' ? 'gone' : 'stale',
  });
  const found = (
    state: ResourceSync<T>,
    value: T,
    at: number,
  ): ResourceSync<T> => {
    if (!ours(state, value)) return unavailable(state);
    const next = adopt(state, value, at);
    return {
      ...next,
      reading: false,
      due: next.due || next.announced > identity.version(next.value),
    };
  };
  return (state: ResourceSync<T>, event: ResourceEvent<T>): ResourceSync<T> => {
    switch (event.type) {
      case 'signal':
        return signalled(state, event.version);
      case 'read':
        return { ...state, reading: true, due: false };
      case 'found':
        return found(state, event.value, event.at);
      case 'unavailable':
        return unavailable(state);
      case 'missing':
        return { ...state, reading: false, due: false, freshness: 'gone' };
      case 'accepted':
        return ours(state, event.value)
          ? adopt(state, event.value, event.at)
          : state;
    }
  };
}

export const shouldRead = <T>(state: ResourceSync<T>): boolean =>
  state.due && !state.reading && state.freshness !== 'gone';
