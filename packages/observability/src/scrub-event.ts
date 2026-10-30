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

/**
 * One chained entry in the vendor's exception list. The vendor flattens an
 * error's whole `cause` chain into `values`, so an innermost database error
 * whose message carries bound parameters (for example the addresses a
 * failed `completeEmailChange` statement bound) arrives here as a later
 * entry. Sanitized like every other entry: retain safe diagnostic metadata
 * and stack frames, never the raw message.
 */
type ScrubbableExceptionEntry = {
  type?: string;
  value?: string;
  [key: string]: unknown;
};

/** The parts of a vendor error event this scrubbing touches. */
export type ScrubbableEvent = {
  request?: ScrubbableRequest | null;
  /** Rebuilt to carry the cuid2 id and nothing else. */
  user?: { id?: string } | Record<string, unknown> | null;
  breadcrumbs?: readonly { category?: string }[] | null;
  /** The vendor's flattened error chain; messages sanitized, metadata kept. */
  exception?: { values?: ScrubbableExceptionEntry[] | null } | null;
  /** Vendors carry more fields than this port names; they pass through. */
  [key: string]: unknown;
};

/**
 * The marker replacing every raw exception message (ADR 0036 §1: personal
 * data never reaches an error report; ADR 0037: implementations scrub
 * before vendor delivery). A serialized message text is never provably
 * safe — a database error's message carries bound parameters, and which
 * parameters is unknowable at the scrub boundary — so no message text is
 * delivered at all. Diagnostic value stays in what is provably safe: the
 * error class, the stack frames, and the bounded `errorCode` tag the
 * reporter sets at capture.
 */
const SCRUBBED_MESSAGE = '[scrubbed]';

/**
 * Every message text in the chain becomes the scrub marker: type,
 * stacktrace, mechanism and every other entry field pass through
 * untouched. Linked causes are covered because the vendor lists the whole
 * chain in `values`. An entry without a value stays without one — no
 * invented field.
 */
function scrubException(
  exception: ScrubbableEvent['exception'],
): ScrubbableEvent['exception'] {
  if (exception === null || exception === undefined) return exception;
  const values = Array.isArray(exception.values) ? exception.values : null;
  return {
    ...exception,
    ...(values === null ? {} : { values: values.map(scrubEntry) }),
  };
}

/** Every message text becomes the scrub marker; everything else passes through. */
const scrubEntry = (entry: ScrubbableExceptionEntry) =>
  entry.value === undefined ? entry : { ...entry, value: SCRUBBED_MESSAGE };

/**
 * Drops the request body, headers, cookies, query string and IP, drops
 * console breadcrumbs, and reduces the user to the cuid2 id alone
 * (ADR 0037 § Error tracking). Replaces every raw exception message in the
 * chain with a fixed marker, so a database failure's bound parameters —
 * which vendor query errors embed in their message — never reach the error
 * report; the type, stack frames and mechanism pass through. Every other
 * field passes through untouched, so vendor-specific fields the adapters
 * never set survive the round trip. Generic over the vendor's own event
 * type: each adapter returns exactly the shape its `beforeSend` expects.
 */
export function scrubEvent<E>(event: E): E {
  const { request, user, breadcrumbs, exception, ...rest } =
    event as ScrubbableEvent;
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
    exception: scrubException(exception),
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
