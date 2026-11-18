import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import {
  clubReleaseFilterOf,
  confirmable,
  filterCounts,
  sameUtcDay,
  sourceLineOf,
  studentsShown,
  type ClubReleaseFilter,
} from '../../../../../features/media-releases/club-releases';
import {
  standingBadgeOf,
  standingBadgeWords,
} from '../../../../../features/media-releases/release-words';
import { ClubReleaseFrame } from '../../../../../ui/clubs/club-frame';
import { ClubReleasesPage } from '../../../../../ui/clubs/releases/club-releases-page';
import { confirmClubReleasesAction } from '../../release-actions';
import { readClubReleasePage } from './read';

export const metadata: Metadata = { title: 'Media releases' };

/** A club confirms the media releases it holds (RClubReleases, ADR 0151). */
export default async function ClubReleases({
  params,
  searchParams,
}: {
  params: Promise<{ club: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { club } = await params;
  const { read, seats, userId, nowMs, releases } = await readClubReleasePage(
    club,
    `/clubs/${club}/releases`,
    searchParams,
  );
  const filter: ClubReleaseFilter = clubReleaseFilterOf(
    (await searchParams).show,
  );
  const viewer = { userId, clubId: read.club.id };
  const rows = studentsShown(read.students, filter).map((student) => {
    const source = sourceLineOf(student.standing, viewer);
    const badge = standingBadgeOf(student.standing);
    return {
      userId: student.userId,
      username: student.username,
      line: [
        sameUtcDay(student.joinedAt, nowMs) ? 'joined today' : null,
        student.askedAt === null ? null : 'asked you to confirm',
      ]
        .filter((part) => part !== null)
        .join(' · '),
      badge,
      badgeText: standingBadgeWords[badge],
      source: source?.text ?? null,
      sourceNote: source?.note ?? null,
      selectable: confirmable(student.standing),
    };
  });
  return (
    <ClubReleaseFrame
      club={read.club}
      seats={seats}
      releases={releases}
      section="releases"
    >
      <ClubReleasesPage
        clubId={read.club.id}
        clubName={read.club.name}
        filter={filter}
        counts={filterCounts(read.students)}
        rows={rows}
        action={confirmClubReleasesAction.bind(null, read.club.id)}
      />
    </ClubReleaseFrame>
  );
}
