import type { Metadata } from 'next';
import type { SearchParams } from '../../../../../features/access/decision';
import {
  youthStudentFilterOf,
  youthStudentsShown,
  youthStudentTallies,
  recordingsLineOf,
} from '../../../../../features/media-releases/club-releases';
import {
  standingBadgeOf,
  standingBadgeWords,
} from '../../../../../features/media-releases/release-words';
import { ClubReleaseFrame } from '../../../../../ui/clubs/club-frame';
import { YouthStudentsPage } from '../../../../../ui/clubs/releases/youth-students-page';
import { readClubReleasePage } from '../releases/read';

export const metadata: Metadata = { title: 'Youth tournaments' };

/** The coach view: the club's Youth students' release status (RTabCoachView, ADR 0151). */
export default async function ClubYouth({
  params,
  searchParams,
}: {
  params: Promise<{ club: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { club } = await params;
  const { read, seats, releases } = await readClubReleasePage(
    club,
    `/clubs/${club}/youth`,
    searchParams,
  );
  const filter = youthStudentFilterOf((await searchParams).release);
  return (
    <ClubReleaseFrame
      club={read.club}
      seats={seats}
      releases={releases}
      section="youth"
    >
      <YouthStudentsPage
        clubId={read.club.id}
        filter={filter}
        tallies={youthStudentTallies(read.students)}
        rows={youthStudentsShown(read.students, filter).map((student) => {
          const badge = standingBadgeOf(student.standing);
          return {
            userId: student.userId,
            username: student.username,
            badge,
            badgeText: standingBadgeWords[badge],
            recordings: recordingsLineOf(student),
          };
        })}
      />
    </ClubReleaseFrame>
  );
}
