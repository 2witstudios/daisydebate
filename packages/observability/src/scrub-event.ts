/**
 * ADR0037: the pure scrub every vendor adapter runs as `beforeSend`, so a
 * raw exception reaches the error tracker only after these fields are gone.
 * Pure: the input event is never mutated, and nothing here reads the clock,
 * the environment or the network.
 */
/** The parts of a request event this scrubbing touches; never exported. */
type ScrubbableRequest = {
  /** The parsed request body: always dropped. */
  data?: unknown;
  /** Request headers: always dropped (cookies and credentials ride here). */
  headers?: unknown;
  /** The raw query string: always dropped (it carries tokens and identifiers). */
  query_string?: unknown;
  /** Cookies: always dropped. */
  cookies?: unknown;
  /** Kept without its query string, so a route is still diagnosable. */
  url?: string;
  /** Kept: the verb alone never identifies anyone. */
  method?: string;
};

/** The parts of a vendor error event this scrubbing touches. */
export type ScrubbableEvent = {
  request?: ScrubbableRequest | null;
  /** Rebuilt to carry the cuid2 id and nothing else. */
  user?: { id?: string } | Record<string, unknown> | null;
  breadcrumbs?: readonly { category?: string }[] | null;
  /** Vendors carry more fields than this port names; they pass through. */
  [key: string]: unknown;
};

/**
 * Drops the request body, headers, cookies, query string and IP, drops
 * console breadcrumbs, and reduces the user to the cuid2 id alone
 * (ADR 0037 § Error tracking). Every other field passes through untouched,
 * so vendor-specific fields the adapters never set survive the round trip.
 * Generic over the vendor's own event type: each adapter returns exactly
 * the shape its `beforeSend` expects.
 */
export function scrubEvent<E>(event: E): E {
  const { request, user, breadcrumbs, ...rest } = event as ScrubbableEvent;
  return {
    ...rest,
    request:
      request === undefined || request === null
        ? request
        : {
            ...(request.url !== undefined
              ? { url: request.url.split('?')[0] }
              : {}),
            ...(request.method !== undefined ? { method: request.method } : {}),
          },
    user: userIdOf(user),
    breadcrumbs: Array.isArray(breadcrumbs)
      ? breadcrumbs.filter((breadcrumb) => breadcrumb.category !== 'console')
      : breadcrumbs,
  } as E;
}

/** The user shrinks to the application id; no id at all means no user. */
function userIdOf(user: ScrubbableEvent['user']): { id?: string } | undefined {
  const id =
    typeof user === 'object' && user !== null && typeof user.id === 'string'
      ? user.id
      : undefined;
  return id === undefined ? undefined : { id };
}
