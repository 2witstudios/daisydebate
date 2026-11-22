import { errorCodeOf } from '@daisy/errors';
import type { RoomClosureTransitions } from '../room-account-closure';
import { subjectRightsAdoption } from './adoption';
import type { PrivacySubject } from './contracts';
import {
  runPrivacyErasure,
  runPrivacyExport,
  type PrivacyVerificationBinding,
} from './operations';
import type { PrivacyErasureInput } from './planner';
import type { TxOpener } from '../tx';
import type { GuardianChildAuthority } from '../guardians/active-child';

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
