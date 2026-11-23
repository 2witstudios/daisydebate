import { errorCodeOf } from '@daisy/errors';
import type { RoomClosureTransitions } from '../room-account-closure';
import type { PrivacySubject } from './contracts';
import {
  runPrivacyErasure,
  runPrivacyExport,
  type PrivacyVerificationBinding,
} from './operations';
import type { PrivacyErasureInput, PrivacyAdoption } from './operations';
import type { TxOpener } from '../tx';
import type { GuardianChildAuthority } from '../guardians/active-child';
import { necessaryEvidencePrivacyAdopter } from '../necessary-evidence-privacy';
import { agreementSignaturePrivacyAdopter } from '../agreement-signatures';
import { audienceReactionPrivacyAdopter } from '../audience-reactions';
import { debaterFollowPrivacyAdopter } from '../debater-follows';
import { notificationPrivacyAdopter } from '../notifications';
import { roomInvitationsPrivacyAdopter } from '../room-invitations/privacy';
import { watchHistoryPrivacyAdopter } from '../watch-history';
import { analyticsConsentPrivacyAdopter } from '../analytics-consent';
import { accountAgePrivacyAdopter } from '../account-age';
import { accountTermsPrivacyAdopter } from '../age-step';
import { betaAccessPrivacyAdopter } from '../beta-access-privacy';
import { clubSeatPrivacyAdopter } from '../club-seat-privacy';
import { mediaReleasePrivacyAdopter } from '../media-release-privacy';
import { documentsPrivacyAdopter } from '../documents-privacy';
import { competitiveRecordPrivacyAdopter } from '../competitive-record-privacy';
import { organizationAuthorityPrivacyAdopter } from '../organization-authority-privacy';
import { guardianLinksPrivacyAdopter } from '../guardians/privacy';
import { tournamentRecordPrivacyAdopter } from '../tournament-record-privacy';
import { entitlementGrantPrivacyAdopter } from '../entitlement-grants-privacy';
import { usagePrivacyAdopter } from '../usage-privacy';
import { billingPrivacyAdopter } from '../billing-privacy';
import { flagsPrivacyAdopter } from '../flags-privacy';
import { contentModerationPrivacyAdopter } from '../content-moderation-privacy';
import { onboardingPrivacyAdopter } from '../onboarding-privacy';
import { publicProfilePrivacyAdopter } from '../public-profile-privacy';
import { createRoomAccountClosureAdopter } from '../room-account-closure';
import { recordingPrivacyAdopter } from '../recording-privacy';
import { roundAnalysisPrivacyAdopter } from '../round-analysis-privacy';
import { roundTranscriptPrivacyAdopter } from '../round-transcript-privacy';
import { challengesPrivacyAdopter } from '../challenges/privacy';
import { contactsPrivacyAdopter } from '../contacts/privacy';
import { moderationPrivacyAdopter } from '../moderation/privacy';
import { reportsPrivacyAdopter } from '../reports/privacy';
import { friendsPrivacyAdopter } from '../friends/privacy';
import { createMessagingPrivacyAdopter } from '../messaging/privacy';
import { presencePrivacyAdopter } from '../presence/privacy';

/** Closes one member's account through every feature's erase step (ADR 0087). */
export const erasePrivacySubject = (
  database: TxOpener,
  input: PrivacyErasureInput,
  rooms: RoomClosureTransitions,
  verificationBindings: readonly PrivacyVerificationBinding[],
) =>
  runPrivacyErasure(
    database,
    input,
    subjectRightsAdoption(rooms),
    verificationBindings,
  );

/** Close a linked child's account and return the subject of the committed closure. */
export async function eraseGuardianChild(
  database: TxOpener,
  input: Omit<PrivacyErasureInput, 'subject'> & GuardianChildAuthority,
  rooms: RoomClosureTransitions,
  verificationBindings: readonly PrivacyVerificationBinding[],
): Promise<PrivacySubject | null> {
  try {
    const erased = await runPrivacyErasure(
      database,
      input,
      subjectRightsAdoption(rooms),
      verificationBindings,
    );
    return erased.subject ?? null;
  } catch (error) {
    if (errorCodeOf(error, 'INTERNAL') === 'NOT_FOUND') return null;
    throw error;
  }
}

/** One member's own data from every feature's export step. */
export const exportPrivacySubject = (
  database: TxOpener,
  subject: PrivacySubject,
  rooms: RoomClosureTransitions,
) => runPrivacyExport(database, subject, subjectRightsAdoption(rooms));

/**
 * Every feature's subject-rights step, each exactly once, in the order it
 * runs (docs/operations/compliance.md). Callers never choose a subset: the
 * public operations always run this whole list. Room closure and Messaging
 * run before sign-in rows go; Contacts runs last of the social steps, once
 * nothing built on the pair remains.
 */
export const subjectRightsAdoption = (
  rooms: RoomClosureTransitions,
): PrivacyAdoption => [
  createRoomAccountClosureAdopter(rooms),
  ...socialPrivacyAdoption(),
  onboardingPrivacyAdopter,
  publicProfilePrivacyAdopter,
  analyticsConsentPrivacyAdopter,
  accountAgePrivacyAdopter,
  accountTermsPrivacyAdopter,
  agreementSignaturePrivacyAdopter,
  betaAccessPrivacyAdopter,
  clubSeatPrivacyAdopter,
  mediaReleasePrivacyAdopter,
  documentsPrivacyAdopter,
  entitlementGrantPrivacyAdopter,
  usagePrivacyAdopter,
  billingPrivacyAdopter,
  flagsPrivacyAdopter,
  contentModerationPrivacyAdopter,
  audienceReactionPrivacyAdopter,
  debaterFollowPrivacyAdopter,
  watchHistoryPrivacyAdopter,
  roomInvitationsPrivacyAdopter,
  notificationPrivacyAdopter,
  necessaryEvidencePrivacyAdopter,
  roundTranscriptPrivacyAdopter,
  roundAnalysisPrivacyAdopter,
  recordingPrivacyAdopter,
  // Authority ends with the account; the tournament record is kept.
  organizationAuthorityPrivacyAdopter,
  guardianLinksPrivacyAdopter,
  tournamentRecordPrivacyAdopter,
  // The record reads last: it only reads, and erasure keeps it (DEC-261).
  competitiveRecordPrivacyAdopter,
];

/**
 * The social capabilities' subject rights, in their required order:
 * Messaging before authentication is scrubbed, then Friends, Challenges,
 * Reports, Moderation and Presence,
 * and Contacts last, once nothing built on the pair remains (B5).
 */
export const socialPrivacyAdoption = () => [
  createMessagingPrivacyAdopter(),
  friendsPrivacyAdopter,
  challengesPrivacyAdopter,
  reportsPrivacyAdopter,
  moderationPrivacyAdopter,
  presencePrivacyAdopter,
  contactsPrivacyAdopter,
];
