/**
 * The viewer's rail width preference (ADR 0091): 'extended' shows each
 * destination's name as visible text beside its icon, 'mini' is the
 * icon-only rail. It travels in a plain, non-secret cookie so the server
 * renders the right column width before first paint, exactly like the
 * theme preference (ADR 0027). Absent is extended: the words are the
 * default. It never touches the request-scoped UI store (ADR 0024), which
 * cannot be sticky by construction.
 */
export const RAIL_PREFERENCES = ['extended', 'mini'] as const;

export type RailPreference = (typeof RAIL_PREFERENCES)[number];

export const RAIL_COOKIE = 'daisy.rail';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * The cookie's one definition: a year at the root, Secure and HttpOnly —
 * the server alone reads and writes it, and no script needs it. Browsers
 * accept Secure cookies on localhost and the TLS edge, like the age hold.
 */
export const RAIL_COOKIE_OPTIONS = {
  path: '/',
  maxAge: ONE_YEAR_SECONDS,
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
} as const;

export const isRailPreference = (raw: unknown): raw is RailPreference =>
  RAIL_PREFERENCES.some((preference) => preference === raw);

/** Trust boundary for the cookie: unknown values fall back to the default. */
export const parseRailPreference = (raw: unknown): RailPreference =>
  isRailPreference(raw) ? raw : 'extended';

/** The choice a toggle leaves behind: mini persists, extended is absence. */
export const flipRailPreference = (
  preference: RailPreference,
): RailPreference => (preference === 'mini' ? 'extended' : 'mini');
