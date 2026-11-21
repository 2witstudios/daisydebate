import { eq, sql } from 'drizzle-orm';
import { organizations } from '../schema/organizations';
import type { Tx } from '../tx';

/**
 * The organization a handle names, case-insensitively, as its id: the
 * address a host page is at. Organizations are open to read.
 */
export const findOrganizationByHandle = async (
  tx: Tx,
  handle: string,
): Promise<string | null> => {
  const [row] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(sql`lower(${organizations.handle})`, handle.toLowerCase()))
    .limit(1);
  return row?.id ?? null;
};
