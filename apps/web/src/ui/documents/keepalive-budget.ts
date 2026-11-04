/**
 * The browser's per-page keepalive body budget for document drafts saves.
 *
 * Every DocumentSync owner in one page shares the browser limit, so the
 * budget is a distinct object injected at the browser edge rather than state
 * hidden inside one sync. Reservations hold only byte counts and a unique
 * object identity; draft content is never interned or globally keyed.
 */
type KeepaliveSaveBody = {
  readonly id: string;
  readonly html: string;
  readonly expectedRevision: number;
};

type KeepaliveReservation = {
  readonly release: () => void;
};

export type KeepaliveBudget = {
  /** Reserves the exact UTF-8 serialized body, or declines it. */
  readonly reserve: (body: KeepaliveSaveBody) => KeepaliveReservation | null;
  /** The bytes currently held by outstanding keepalive sends. */
  readonly total: () => number;
};

const KEEPALIVE_BODY_BUDGET = 64 * 1024;

/** The one serialized save body, so the budget measures exactly what is sent. */
export const serializeSaveBody = ({
  id,
  html,
  expectedRevision,
}: KeepaliveSaveBody): string => JSON.stringify({ id, html, expectedRevision });

const serializedBodyBytes = (body: KeepaliveSaveBody): number =>
  new TextEncoder().encode(serializeSaveBody(body)).length;

export const createKeepaliveBudget = (
  limitBytes: number = KEEPALIVE_BODY_BUDGET,
): KeepaliveBudget => {
  const outstanding = new Set<{ readonly bytes: number }>();
  const total = () =>
    [...outstanding].reduce((sum, order) => sum + order.bytes, 0);
  return {
    reserve: (body) => {
      const bytes = serializedBodyBytes(body);
      if (bytes > limitBytes - total()) return null;
      const order = { bytes };
      outstanding.add(order);
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          outstanding.delete(order);
        },
      };
    },
    total,
  };
};
