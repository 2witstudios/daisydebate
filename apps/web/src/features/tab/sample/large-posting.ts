import type { PostingView } from '@daisy/protocol/lobby/posting-read';
import {
  largeJudge,
  largeSchool,
  largeSchoolCount,
  largeSurname,
  spread,
} from './large-names';
import { initials, judge, named, postedFixture } from './posting';

/** The complete large posting, keeping public initials and school names separate. */
export function largePosting(
  posting: PostingView,
  visitor: boolean,
): PostingView {
  const fixtures = Array.from({ length: 100 }, (_, n) => {
    const fixture = postedFixture(
      `large-round-${posting.tabRound.number}-room-${n + 1}`,
      `Room ${n + 1}`,
      [0, 1].map((side) =>
        visitor
          ? initials(`${largeSurname(n * 2 + side).slice(0, 1)}.`)
          : named(largeSurname(n * 2 + side)),
      ),
      [judge(largeJudge(n))],
      !visitor,
    );
    return {
      ...fixture,
      entries: fixture.entries.map((entry, side) => ({
        ...entry,
        school: largeSchool(spread(n * 2 + side, largeSchoolCount)),
      })),
    };
  });
  return { ...posting, roomCount: 100, fixtures, more: 0 };
}
