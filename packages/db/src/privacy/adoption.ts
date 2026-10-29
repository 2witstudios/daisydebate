import { accountAgePrivacyAdopter } from '../account-age';
import { accountTermsPrivacyAdopter } from '../age-step';
import { betaAccessPrivacyAdopter } from '../beta-access-privacy';
import { competitiveRecordPrivacyAdopter } from '../competitive-record-privacy';
import { entitlementGrantPrivacyAdopter } from '../entitlement-grants-privacy';
import { onboardingPrivacyAdopter } from '../onboarding-privacy';
import {
  createRoomAccountClosureAdopter,
  type RoomClosureTransitions,
} from '../room-account-closure';
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
  accountAgePrivacyAdopter,
  accountTermsPrivacyAdopter,
  betaAccessPrivacyAdopter,
  entitlementGrantPrivacyAdopter,
  roundTranscriptPrivacyAdopter,
  roundAnalysisPrivacyAdopter,
  // The record reads last: it only reads, and erasure keeps it (DEC-261).
  competitiveRecordPrivacyAdopter,
];
