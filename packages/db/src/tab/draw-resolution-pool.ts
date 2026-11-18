import { and, asc, eq, or } from 'drizzle-orm';
import { resolutionPools, poolResolutions } from '../schema/resolution-pools';
import type { tabRounds } from '../schema/events';
import { scopeTransaction } from '../tenant-scope';
import type { lockEventSettingContext } from './event-setting-context';
import type { TabTransaction } from './tab-transaction';
type Configuration = NonNullable<
  Awaited<ReturnType<typeof lockEventSettingContext>>
>;
/** The setup command admits only this lobby's pools and its owning organization's pools. */
export const loadDrawResolutionPool = async (
  tx: TabTransaction,
  configuration: Configuration,
  round: typeof tabRounds.$inferSelect,
) => {
  if (!round.resolutionPoolId) return null;
  const { scope, lobby } = configuration;
  await scopeTransaction(tx, scope);
  const [pool] = await tx
    .select()
    .from(resolutionPools)
    .where(
      and(
        eq(resolutionPools.id, round.resolutionPoolId),
        or(
          eq(resolutionPools.lobbyId, lobby.id),
          ...(lobby.ownerOrganizationId
            ? [eq(resolutionPools.organizationId, lobby.ownerOrganizationId)]
            : []),
        ),
      ),
    )
    .for('share');
  if (!pool) return null;
  const resolutions = await tx
    .select()
    .from(poolResolutions)
    .where(eq(poolResolutions.poolId, pool.id))
    .orderBy(asc(poolResolutions.id))
    .for('share');
  return { pool, resolutions };
};
