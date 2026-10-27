/**
 * The canonical admin origin (ADR 0076). The owner reaches the app only as
 * `http://localhost:4800` through `fly proxy`; WebAuthn binds credentials to
 * RP ID `localhost`, and the port belongs to the origin alone. Any other
 * Host, `127.0.0.1` and `[::1]` included, is answered 421 before anything
 * runs, which also defeats DNS rebinding.
 */
const ADMIN_HOST = 'localhost:4800';
export const ADMIN_ORIGIN = `http://${ADMIN_HOST}`;
export const ADMIN_RP_ID = 'localhost';
export const MISDIRECTED_STATUS = 421;

export const hostAllowed = (host: string | null | undefined): boolean =>
  host === ADMIN_HOST;

/** Every server action's CSRF check: the browser-sent Origin, exactly. */
export const sameOrigin = (origin: string | null | undefined): boolean =>
  origin === ADMIN_ORIGIN;
