import { SQL } from 'bun';
import { readTenantIsolationProblems } from '@daisy/db/tenant-isolation';
import type { DoctorCheck } from './doctor';

const check = (status: DoctorCheck['status'], detail: string): DoctorCheck => ({
  name: 'tenant-isolation',
  status,
  detail,
});

/**
 * Every tenant-owned table of the migrated database is fenced by row-level
 * security as the manifest declares: the check production start-up runs.
 */
export async function checkTenantIsolation(
  url: string | undefined,
): Promise<DoctorCheck> {
  if (!url) return check('fail', 'DATABASE_URL unavailable');
  const client = new SQL(url, { max: 1, connectionTimeout: 3 });
  try {
    const problems = await readTenantIsolationProblems((statement) =>
      client.unsafe(statement),
    );
    return problems.length === 0
      ? check('pass', 'every tenant-owned table is fenced')
      : check('fail', problems.join('; '));
  } catch {
    return check('fail', 'catalog unavailable');
  } finally {
    await client.close({ timeout: 5 });
  }
}
