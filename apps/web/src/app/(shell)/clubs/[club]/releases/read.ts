import type { ClubReleasesRead } from '@daisy/db/stores/media-releases';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import type { SearchParams } from '../../../../../features/access/decision';
import { clubSeatsViewSchema } from '../../../../../features/clubs/views';
import { needsRelease } from '../../../../../features/media-releases/club-releases';
import { requireAccess } from '../../../../../features/access/page-access';
import { GET as releasesRoute } from '../../../../api/clubs/[club]/releases/route';
import { GET as seatsRoute } from '../../../../api/clubs/[club]/seats/route';
import { readOwnRoute } from '../../../../../server/render-read';

/** The route's own answer, read in process: its shape is the database read's. */
const releasesReadSchema = z.object({
  read: z.custom<ClubReleasesRead>(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      'club' in value &&
      'students' in value,
  ),
  nowMs: z.number(),
});

/**
 * A club's media release pages' read (ADR 0151), through the route a script
 * would call: only while youth publishing is open, and only for the club's
 * owner or a school's staff; anyone else finds no such page. `club` is the
 * club's id, or its handle from a notice's link. The owner also gets their
 * seats summary, so Seats and Billing stay in reach.
 */
export async function readClubReleasePage(
  club: string,
  path: string,
  searchParams: Promise<SearchParams>,
) {
  const identity = await requireAccess(path, searchParams);
  if (identity.state !== 'member' || club.length > 80) notFound();
  const answer = await readOwnRoute(
    (request) => releasesRoute(request, { params: Promise.resolve({ club }) }),
    `/api/clubs/${encodeURIComponent(club)}/releases`,
    releasesReadSchema,
  );
  if (answer === null) notFound();
  const { read, nowMs } = answer;
  const seats =
    read.role === 'owner'
      ? await readOwnRoute(
          (request) =>
            seatsRoute(request, {
              params: Promise.resolve({ club: read.club.id }),
            }),
          `/api/clubs/${read.club.id}/seats`,
          clubSeatsViewSchema,
        )
      : null;
  return {
    read,
    seats,
    userId: identity.principal.userId,
    nowMs,
    releases: {
      needing: read.students.filter((s) => needsRelease(s.standing)).length,
    },
  };
}

/**
 * The media release tabs for the owner's Seats and Billing pages: the count
 * of students needing a release, or null while releases are closed.
 */
export async function readClubReleaseTabs(
  clubId: string,
): Promise<{ readonly needing: number } | null> {
  return readOwnRoute(
    (request) =>
      releasesRoute(request, { params: Promise.resolve({ club: clubId }) }),
    `/api/clubs/${encodeURIComponent(clubId)}/releases?count=needing`,
    z.object({ needing: z.number().int().nonnegative() }),
  );
}
