import type { BrowserContext, Page } from '@playwright/test';
import { roundViewSchema, type RoundView } from '@daisy/protocol';

/** The m:ss reading of a live round clock ("aria-label": label m:ss). */
const parseClock = (aria: string | null): number => {
  const [reading] = (aria?.split(' ') ?? []).slice(-1);
  if (!reading?.includes(':')) return Number.POSITIVE_INFINITY;
  const [minutes, seconds] = [
    Number(reading.split(':')[0]),
    Number(reading.split(':')[1]),
  ];
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds))
    return Number.POSITIVE_INFINITY;
  return minutes * 60_000 + seconds * 1000;
};

/** The newest stored segment row's remaining duration, from the server's own rows. */
const openSegmentRemaining = (view: RoundView, atMs: number) => {
  const row = view.segments.at(-1);
  if (!row || row.endedAt !== null) return null;
  return Date.parse(row.startedAt) + row.durationMs - atMs;
};

/** How far the page's clock is from the server's own timetable right now. */
export async function displayDeltaMs(
  page: Page,
  member: { readonly context: BrowserContext },
  roundId: string,
): Promise<number> {
  const [aria, body] = await Promise.all([
    page.getByRole('timer').getAttribute('aria-label'),
    member.context.request.get(`/api/rounds/${roundId}`),
  ]);
  // A refused read is an answer to ask again: capacity refused it unrun.
  if (body.status() === 503) return Number.POSITIVE_INFINITY;
  const displayed = parseClock(aria);
  const latest = openSegmentRemaining(
    roundViewSchema.parse(await body.json()),
    Number(body.headers()['x-server-now-ms']),
  );
  if (displayed === Number.POSITIVE_INFINITY || latest === null)
    return Number.POSITIVE_INFINITY; // keep polling until both are in place
  return Math.abs(displayed - latest);
}
