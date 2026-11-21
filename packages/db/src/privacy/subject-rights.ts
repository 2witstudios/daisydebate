import type { RoomClosureTransitions } from '../room-account-closure';
import { subjectRightsAdoption } from './adoption';
import type { PrivacySubject, PrivacyDatabase } from './contracts';
import {
  runPrivacyErasure,
  runPrivacyExport,
  type PrivacyVerificationBinding,
} from './operations';
import type { PrivacyErasureInput } from './planner';
import type { GuardianChildAuthority } from '../guardians/active-child';

/** Closes one member's account through every feature's erase step (ADR 0087). */
export const erasePrivacySubject = (
  database: PrivacyDatabase,
  input:
    | PrivacyErasureInput
    | (Omit<PrivacyErasureInput, 'subject'> & GuardianChildAuthority),
  rooms: RoomClosureTransitions,
  verificationBindings: readonly PrivacyVerificationBinding[],
) =>
  runPrivacyErasure(
    database,
    input,
    subjectRightsAdoption(rooms),
    verificationBindings,
  );

/** One member's own data from every feature's export step. */
export const exportPrivacySubject = (
  database: PrivacyDatabase,
  subject: PrivacySubject,
  rooms: RoomClosureTransitions,
) => runPrivacyExport(database, subject, subjectRightsAdoption(rooms));
