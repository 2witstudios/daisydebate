import { systemId } from '@daisy/clock';
import { requireAdminTestDatabase } from '@daisy/config';
import { afterAll, beforeEach } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { AuthDeps } from '../src/auth/attempts';
import { beginEnrollment, finishEnrollment } from '../src/auth/enrollment';
import { beginSignIn } from '../src/auth/sign-in';
import { softAuthenticator } from '../src/auth/soft-authenticator.test-support';
import {
  issueEnrollment,
  type EnrollmentMode,
} from '../src/auth/issue-enrollment';
import { systemRandom } from '../src/auth/secrets';
import { canonicalCeremony } from '../src/auth/webauthn';
import { openAdminDatabase } from '../src/db/client';

/**
 * One owner connection to this slot's admin test database
 * (`requireAdminTestDatabase`). Suites run one file at a time, and every
 * test starts from empty tables; the owner may reset what the runtime role
 * never could.
 */
function adminTestDatabase() {
  const handle = openAdminDatabase(requireAdminTestDatabase(process.env));
  const reset = async () => {
    await handle.db.execute(sql`
      truncate audit_events, chain_checkpoints, auth_attempts,
        operator_sessions, operator_challenges, operator_credentials,
        operator_enrollments, operators
    `);
  };
  return { ...handle, reset };
}

/** The suite's database, emptied before each test and closed after the file. */
export function suiteDatabase() {
  const database = adminTestDatabase();
  beforeEach(async () => {
    await database.reset();
  });
  afterAll(() => database.close());
  return database;
}

/** A clock the test moves by hand; IDs are CSPRNG cuid2s (integration isolation). */
export function testDeps(
  db: AuthDeps['db'],
  start = '2026-10-26T12:00:00.000Z',
): AuthDeps & { readonly advance: (ms: number) => void } {
  let current = Date.parse(start);
  return {
    db,
    clock: { now: () => new Date(current).toISOString() },
    ids: systemId,
    random: systemRandom,
    attemptKey: 'integration-attempt-key-0000000000000000000',
    ceremony: canonicalCeremony,
    advance: (ms) => {
      current += ms;
    },
  };
}

export async function enrollmentToken(
  deps: AuthDeps,
  name = 'owner',
  mode: EnrollmentMode = 'initial',
): Promise<string> {
  const result = await issueEnrollment(deps, { name, mode });
  if (!result.ok) throw new Error(`Enrollment refused: ${result.reason}`);
  return result.url.split('#')[1] ?? '';
}

export const address = '203.0.113.7';

/** A register challenge for `token`, answered by a fresh software passkey. */
export async function registration(
  deps: AuthDeps,
  token: string,
  seed: number,
  flags: { readonly backedUp?: boolean } = {},
) {
  const begun = await beginEnrollment(deps, { token, address });
  if (!begun.ok) throw new Error('beginEnrollment refused');
  const device = await softAuthenticator(seed);
  const response = await device.register(
    begun.options.challenge,
    deps.ceremony,
    flags,
  );
  return { device, response };
}

/** Enrolls a fresh owner passkey and returns the device that holds it. */
export async function enrolledOwner(
  deps: AuthDeps,
  seed: number,
  flags: { readonly backedUp?: boolean } = {},
) {
  const token = await enrollmentToken(deps);
  const { device, response } = await registration(deps, token, seed, flags);
  const finished = await finishEnrollment(deps, { token, address, response });
  if (!finished.ok) throw new Error('finishEnrollment refused');
  return device;
}

/** A fresh sign-in challenge answered by `device` with `counter`. */
export async function assertion(
  deps: AuthDeps,
  device: Awaited<ReturnType<typeof softAuthenticator>>,
  counter: number,
) {
  const begun = await beginSignIn(deps, { address });
  if (!begun.ok) throw new Error('beginSignIn refused');
  return device.assert(begun.options.challenge, deps.ceremony, counter);
}
