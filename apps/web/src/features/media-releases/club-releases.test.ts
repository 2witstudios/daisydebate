import type { ClubReleaseStudent } from '@daisy/db';
import type {
  MediaReleaseRecord,
  ReleaseRequest,
  ReleaseStanding,
} from '@daisy/protocol/media-release';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  clubReleaseFilterOf,
  youthStudentFilterOf,
  youthStudentsShown,
  youthStudentTallies,
  confirmable,
  filterCounts,
  recordingsLineOf,
  sameUtcDay,
  sourceLineOf,
  studentsShown,
} from './club-releases';

setupRitewayBun();

const club = 'c'.repeat(24);
const coach = 'd'.repeat(24);
const request: ReleaseRequest = {
  id: 'r'.repeat(24),
  subjectUserId: 's'.repeat(24),
  recipientEmail: 'p@example.com',
  requestedAt: '2026-11-15T10:00:00.000Z',
  expiresAt: '2026-11-29T10:00:00.000Z',
  outcome: null,
  resolvedAt: null,
  sends: 1,
  lastSentAt: '2026-11-15T10:00:00.000Z',
};
const parent: MediaReleaseRecord = {
  id: 'p'.repeat(24),
  subjectUserId: 's'.repeat(24),
  scope: 'publish',
  attestation: {
    kind: 'parent',
    name: 'Elena Rivera',
    relation: 'parent',
    email: 'p@example.com',
  },
  wordingVersion: '2026-11-v1',
  signedAt: '2026-11-16T14:32:00.000Z',
  withdrawnAt: null,
  withdrawnBy: null,
};
const byClub = (attestedByUserId: string, organizationId = club) =>
  ({
    ...parent,
    attestation: {
      kind: 'club',
      organizationId,
      organizationName: 'Lakeside Debate',
      attestedByUserId,
      name: 'Dana Mensah',
      role: 'Coach',
    },
    signedAt: '2026-11-01T09:00:00.000Z',
  }) satisfies MediaReleaseRecord;

const none: ReleaseStanding = { kind: 'none' };
const waiting: ReleaseStanding = {
  kind: 'waiting',
  request,
  afterParentWithdrawal: false,
};
const withdrawn: ReleaseStanding = {
  kind: 'withdrawn',
  release: {
    ...parent,
    withdrawnAt: '2026-11-02T08:00:00.000Z',
    withdrawnBy: 'parent',
  },
};
const onFile: ReleaseStanding = {
  kind: 'on_file',
  publish: parent,
  paidAds: false,
};

const student = (
  standing: ReleaseStanding,
  username: string,
): Pick<ClubReleaseStudent, 'standing' | 'username'> => ({
  standing,
  username,
});

test('the release filters', () => {
  const students = [
    student(none, 'a'),
    student(waiting, 'b'),
    student(withdrawn, 'c'),
    student(onFile, 'd'),
  ];
  assert({
    given: 'each filter',
    should: 'show those without a release, those on file, or everyone',
    actual: [
      studentsShown(students, 'needs').map((s) => s.username),
      studentsShown(students, 'on_file').map((s) => s.username),
      studentsShown(students, 'everyone').length,
      filterCounts(students),
    ],
    expected: [
      ['a', 'b', 'c'],
      ['d'],
      4,
      { needs: 3, on_file: 1, everyone: 4 },
    ],
  });
  assert({
    given: 'an unknown or missing filter',
    should: 'show those who need a release',
    actual: [
      clubReleaseFilterOf('x'),
      clubReleaseFilterOf(undefined),
      clubReleaseFilterOf('on_file'),
    ],
    expected: ['needs', 'needs', 'on_file'],
  });
  assert({
    given: 'each standing',
    should: 'let the club select only none and waiting',
    actual: [none, waiting, withdrawn, onFile].map(confirmable),
    expected: [true, true, false, false],
  });
});

test('the source line', () => {
  const viewer = { userId: coach, clubId: club };
  assert({
    given: 'each standing',
    should: 'say where the release stands, in the board’s words',
    actual: [
      sourceLineOf(none, viewer),
      sourceLineOf(waiting, viewer),
      sourceLineOf(withdrawn, viewer),
      sourceLineOf(onFile, viewer),
      sourceLineOf(
        { kind: 'on_file', publish: byClub(coach), paidAds: false },
        viewer,
      ),
      sourceLineOf(
        { kind: 'on_file', publish: byClub('e'.repeat(24)), paidAds: false },
        viewer,
      ),
      sourceLineOf(
        {
          kind: 'on_file',
          publish: byClub('e'.repeat(24), 'o'.repeat(24)),
          paidAds: false,
        },
        viewer,
      ),
    ],
    expected: [
      null,
      { text: 'Parent asked 15 Nov', note: null },
      {
        text: 'Withdrawn by parent 2 Nov',
        note: 'A parent withdrew. Only the parent can sign again.',
      },
      { text: 'Signed by parent 16 Nov', note: null },
      { text: 'You confirmed 1 Nov', note: null },
      { text: 'Dana Mensah confirmed 1 Nov', note: null },
      { text: 'Lakeside Debate confirmed 1 Nov', note: null },
    ],
  });
  assert({
    given: 'a join today and one yesterday',
    should: 'say joined today only for today, in UTC',
    actual: [
      sameUtcDay(
        '2026-11-18T01:00:00.000Z',
        Date.parse('2026-11-18T23:00:00.000Z'),
      ),
      sameUtcDay(
        '2026-11-17T23:00:00.000Z',
        Date.parse('2026-11-18T01:00:00.000Z'),
      ),
      sameUtcDay(null, 0),
    ],
    expected: [true, false, false],
  });
});

test('the coach view', () => {
  const students = [
    student(onFile, 'sam'),
    student(waiting, 'theo'),
    student(none, 'priya'),
    student(withdrawn, 'kai'),
  ];
  assert({
    given: 'four Youth students',
    should: 'count releases on file and those waiting on a parent',
    actual: youthStudentTallies(students),
    expected: {
      onFile: 1,
      youth: 4,
      waiting: 1,
      waitingNames: ['@theo'],
    },
  });
  assert({
    given: 'each release standing',
    should: 'say whether the student’s Rounds may be reused',
    actual: [
      recordingsLineOf(student(onFile, 'x')),
      recordingsLineOf(student(waiting, 'y')),
      recordingsLineOf(student(none, 'z')),
      recordingsLineOf(student(withdrawn, 'w')),
    ],
    expected: [
      'Clipping and reuse allowed',
      'No reuse until signed',
      'No reuse: no release',
      'No reuse: withdrawn',
    ],
  });
  assert({
    given: 'each release filter',
    should:
      'show the students in that state; no release includes a withdrawn one',
    actual: [
      youthStudentsShown(students, 'any').length,
      youthStudentsShown(students, 'none').map((s) => s.username),
      youthStudentsShown(students, 'waiting').map((s) => s.username),
      youthStudentsShown(students, 'on_file').map((s) => s.username),
      youthStudentFilterOf('nope'),
    ],
    expected: [4, ['priya', 'kai'], ['theo'], ['sam'], 'any'],
  });
});
