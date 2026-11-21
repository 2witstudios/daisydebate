import type {
  AskRefusal,
  GuardianRelation,
  PublishRefusal,
  ReleaseStanding,
  ResendRefusal,
} from '@daisy/protocol/media-release';

/** How the release's signer is related to the minor, in words. */
export const guardianRelationWords: Record<GuardianRelation, string> = {
  parent: 'parent',
  legal_guardian: 'legal guardian',
};

/** "29 Nov 2026", in UTC. */
export const releaseDate = (at: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(at));

/** "29 Nov", in UTC. */
export const releaseDay = (at: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(at));

/** "16 Nov 2026, 14:32", in UTC. */
export const releaseMoment = (at: string): string =>
  `${releaseDate(at)}, ${new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(new Date(at))}`;

/** Why a minor's request was not sent, in words. */
export const askRefusalWords: Record<AskRefusal, string> = {
  not_youth: 'Media releases are for members under 18.',
  already_released: 'A media release is already on file for you.',
  invalid_email: 'Enter an email address.',
  recipient_stopped:
    'That address has asked Daisy not to send it release requests.',
  too_many: 'You have sent the most requests for today. Try again tomorrow.',
};

export const resendRefusalWords: Record<ResendRefusal, string> = {
  not_open: 'That request has ended. Send a new one.',
  too_soon: 'We just sent it. Give it ten minutes before sending again.',
  too_many: 'That request has been sent the most times. Use another email.',
};

const publishRefusalWords: Record<PublishRefusal | 'not_found', string> = {
  closed: 'Sharing Youth recordings is not open yet.',
  not_a_debater: 'Only a debater in this Round can share it.',
  releases_missing: 'Every youth debater needs a media release first.',
  not_available: 'This recording can’t be shared.',
  already_public: 'This recording is already public.',
  not_found: 'This recording can’t be shared.',
};

/** The badge a standing shows on Settings, the club table and the coach view. */
export type StandingBadge =
  'none' | 'waiting' | 'on_file_parent' | 'on_file_club' | 'withdrawn';

export const standingBadgeOf = (standing: ReleaseStanding): StandingBadge => {
  switch (standing.kind) {
    case 'none':
      return 'none';
    case 'waiting':
      return 'waiting';
    case 'withdrawn':
      return 'withdrawn';
    case 'on_file':
      return standing.publish.attestation.kind === 'parent'
        ? 'on_file_parent'
        : 'on_file_club';
  }
};

export const standingBadgeWords: Record<StandingBadge, string> = {
  none: 'No release',
  waiting: 'Waiting for parent',
  on_file_parent: 'On file · parent',
  on_file_club: 'Confirmed by club',
  withdrawn: 'Withdrawn',
};

/** What a standing means for the student's Recordings (coach view). */
export const recordingLineWords: Record<StandingBadge, string> = {
  none: 'Private: no release',
  waiting: 'Private until signed',
  on_file_parent: 'Publishable',
  on_file_club: 'Publishable',
  withdrawn: 'Private: withdrawn',
};

/** The page's notice after Share publicly, from its fixed key; none on success. */
export const shareNoticeOf = (key: string): string | null => {
  if (key === '' || key === 'shared') return null;
  if (key === 'rate_limited')
    return 'Too many tries. Wait a little and try again.';
  return Object.hasOwn(publishRefusalWords, key)
    ? publishRefusalWords[key as keyof typeof publishRefusalWords]
    : 'This recording could not be shared. Try again.';
};
