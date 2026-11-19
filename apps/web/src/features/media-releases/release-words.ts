import type {
  AskRefusal,
  GuardianRelation,
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

/**
 * What a standing means for the student's Rounds (coach view): whether they
 * may be clipped, downloaded and reused. Watching follows the Room's rules
 * either way (ADR 0159).
 */
export const recordingLineWords: Record<StandingBadge, string> = {
  none: 'No reuse: no release',
  waiting: 'No reuse until signed',
  on_file_parent: 'Clipping and reuse allowed',
  on_file_club: 'Clipping and reuse allowed',
  withdrawn: 'No reuse: withdrawn',
};
