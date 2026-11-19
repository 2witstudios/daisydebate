import type { ClubReleaseStudent } from '@daisy/db';
import type { ReleaseStanding } from '@daisy/protocol/media-release';
import {
  recordingLineWords,
  releaseDay,
  standingBadgeOf,
} from './release-words';

/**
 * A club's media release pages as views (ADR 0151, boards RClubReleases and
 * RTabCoachView): which students a filter shows, who can be selected, the
 * source line under each release, and the coach view's tallies. Pure.
 */

const clubReleaseFilters = ['needs', 'on_file', 'everyone'] as const;
export type ClubReleaseFilter = (typeof clubReleaseFilters)[number];

export const clubReleaseFilterOf = (value: unknown): ClubReleaseFilter =>
  clubReleaseFilters.includes(value as ClubReleaseFilter)
    ? (value as ClubReleaseFilter)
    : 'needs';

/** A student needs a release unless one is on file. */
export const needsRelease = (standing: ReleaseStanding): boolean =>
  standing.kind !== 'on_file';

/**
 * The club may confirm only for a student with none, or one waiting on a
 * parent who has not withdrawn before: only that parent can sign again.
 */
export const confirmable = (standing: ReleaseStanding): boolean =>
  standing.kind === 'none' ||
  (standing.kind === 'waiting' && !standing.afterParentWithdrawal);

export const studentsShown = <S extends Pick<ClubReleaseStudent, 'standing'>>(
  students: readonly S[],
  filter: ClubReleaseFilter,
): readonly S[] =>
  filter === 'everyone'
    ? students
    : students.filter(
        (student) => needsRelease(student.standing) === (filter === 'needs'),
      );

export const filterCounts = (
  students: readonly Pick<ClubReleaseStudent, 'standing'>[],
): Record<ClubReleaseFilter, number> => {
  const needs = students.filter((s) => needsRelease(s.standing)).length;
  return {
    needs,
    on_file: students.length - needs,
    everyone: students.length,
  };
};

/** Where a release came from, in the board's Source column; null shows a dash. */
export type SourceLine = {
  readonly text: string;
  /** Said under a parent's withdrawal: the club cannot confirm over it. */
  readonly note: string | null;
} | null;

export const sourceLineOf = (
  standing: ReleaseStanding,
  viewer: { readonly userId: string; readonly clubId: string },
): SourceLine => {
  switch (standing.kind) {
    case 'none':
      return null;
    case 'waiting':
      return {
        text: `Parent asked ${releaseDay(standing.request.requestedAt)}`,
        note: null,
      };
    case 'withdrawn':
      return {
        text: `Withdrawn by parent ${releaseDay(standing.release.withdrawnAt ?? standing.release.signedAt)}`,
        note: 'A parent withdrew. Only the parent can sign again.',
      };
    case 'on_file': {
      const { attestation, signedAt } = standing.publish;
      const when = releaseDay(signedAt);
      if (attestation.kind === 'parent')
        return {
          text: `Signed by ${attestation.relation === 'legal_guardian' ? 'guardian' : 'parent'} ${when}`,
          note: null,
        };
      if (attestation.attestedByUserId === viewer.userId)
        return { text: `You confirmed ${when}`, note: null };
      return {
        text:
          attestation.organizationId === viewer.clubId
            ? `${attestation.name} confirmed ${when}`
            : `${attestation.organizationName} confirmed ${when}`,
        note: null,
      };
    }
  }
};

/** Whether an instant falls on the same UTC day as now. */
export const sameUtcDay = (at: string | null, nowMs: number): boolean =>
  at !== null &&
  new Date(at).toISOString().slice(0, 10) ===
    new Date(nowMs).toISOString().slice(0, 10);

/** The coach view's tiles. */
export const youthStudentTallies = (
  students: readonly Pick<
    ClubReleaseStudent,
    'standing' | 'username' | 'youthRounds'
  >[],
) => {
  const waiting = students.filter((s) => s.standing.kind === 'waiting');
  return {
    onFile: students.filter((s) => s.standing.kind === 'on_file').length,
    youth: students.length,
    waiting: waiting.length,
    waitingNames: waiting.map((s) =>
      s.username === null ? 'A student' : `@${s.username}`,
    ),
    privateRounds: students.reduce((sum, s) => sum + s.youthRounds.private, 0),
  };
};

/** A student's Recordings: counted when they have any, else what their release means. */
export const recordingsLineOf = (
  student: Pick<ClubReleaseStudent, 'standing' | 'youthRounds'>,
): string => {
  const { public: shown, private: hidden } = student.youthRounds;
  if (shown + hidden === 0)
    return recordingLineWords[standingBadgeOf(student.standing)];
  return [
    shown > 0 ? `${shown} public` : null,
    hidden > 0 ? `${hidden} private` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
};

/** The coach view's release filter. */
const youthStudentFilters = ['any', 'none', 'waiting', 'on_file'] as const;
export type YouthStudentFilter = (typeof youthStudentFilters)[number];

export const youthStudentFilterOf = (value: unknown): YouthStudentFilter =>
  youthStudentFilters.includes(value as YouthStudentFilter)
    ? (value as YouthStudentFilter)
    : 'any';

export const youthStudentsShown = <
  S extends Pick<ClubReleaseStudent, 'standing'>,
>(
  students: readonly S[],
  filter: YouthStudentFilter,
): readonly S[] =>
  filter === 'any'
    ? students
    : students.filter((s) =>
        filter === 'none'
          ? s.standing.kind === 'none' || s.standing.kind === 'withdrawn'
          : s.standing.kind === filter,
      );
