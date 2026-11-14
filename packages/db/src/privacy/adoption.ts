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
import { documentsPrivacyAdopter } from '../documents-privacy';
import { competitiveRecordPrivacyAdopter } from '../competitive-record-privacy';
import { organizationAuthorityPrivacyAdopter } from '../organization-authority-privacy';
import { guardianLinksPrivacyAdopter } from '../guardian-links-privacy';
import { tournamentRecordPrivacyAdopter } from '../tournament-record-privacy';
import { entitlementGrantPrivacyAdopter } from '../entitlement-grants-privacy';
import { usagePrivacyAdopter } from '../usage-privacy';
import { billingPrivacyAdopter } from '../billing-privacy';
import { flagsPrivacyAdopter } from '../flags-privacy';
import { contentModerationPrivacyAdopter } from '../content-moderation-privacy';
import { onboardingPrivacyAdopter } from '../onboarding-privacy';
import {
  createRoomAccountClosureAdopter,
  type RoomClosureTransitions,
} from '../room-account-closure';
import { recordingPrivacyAdopter } from '../recording-privacy';
import { roundAnalysisPrivacyAdopter } from '../round-analysis-privacy';
import { roundTranscriptPrivacyAdopter } from '../round-transcript-privacy';
import { socialPrivacyAdoption } from '../social-privacy-composition';
import type { PrivacyAdoption } from './planner';

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
  analyticsConsentPrivacyAdopter,
  accountAgePrivacyAdopter,
  accountTermsPrivacyAdopter,
  agreementSignaturePrivacyAdopter,
  betaAccessPrivacyAdopter,
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
