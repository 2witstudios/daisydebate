import { causeChainMember } from './capacity-refusal';

/** The driver's fields for a server error (`errno`) or a dropped connection (`code`). */
type DriverFailure = { readonly errno?: unknown; readonly code?: unknown };
const SQLSTATE_FAILURES: Readonly<Record<string, string>> = {
  '55P03': 'lock_timeout',
  '57014': 'statement_timeout',
};
const fromDriver = (error: Error) => {
  const { errno, code } = error as DriverFailure;
  return (
    typeof errno === 'string' ||
    (typeof code === 'string' && code.startsWith('ERR_POSTGRES'))
  );
};

/**
 * What the database said about a failed read, as a fixed loggable word, or
 * null for a failure that never reached it (a code bug). Never the raw error.
 */
export function databaseFailure(error: unknown): string | null {
  const failure = causeChainMember(fromDriver, error);
  if (!failure) return null;
  const { errno } = failure as DriverFailure;
  return (typeof errno === 'string' && SQLSTATE_FAILURES[errno]) || 'database';
}
