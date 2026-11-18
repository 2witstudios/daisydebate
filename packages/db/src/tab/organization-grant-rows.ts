import { asc, eq } from 'drizzle-orm';
import { lobbies } from '../schema/lobbies';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import { loadGrantRows, type GrantRow } from './grant-rows';
import type { TabTransaction } from './tab-transaction';

/**
 * Runs one step under a lobby's scope inside the open transaction, then
 * restores the scope the transaction had. The `grants` fence shows a
 * lobby's grants only under that lobby's scope, one lobby at a time, so a
 * step that reads or revokes another person's lobby grant runs here.
 */
export const underLobbyScope = async <T>(
  tx: TabTransaction,
  scope: TenantScope,
  lobbyId: string,
  step: () => Promise<T>,
): Promise<T> => {
  await scopeTransaction(tx, { ...scope, lobbyId });
  const answer = await step();
  await scopeTransaction(tx, scope);
  return answer;
};

const byGrantedThenId = (a: GrantRow, b: GrantRow): number =>
  a.grantedAt.localeCompare(b.grantedAt) || a.id.localeCompare(b.id);

/**
 * The grants these people hold at an organization and at every lobby it
 * owns, and any grant named by id, in the transaction the fence scoped to
 * the organization: its own grants under that scope, then each lobby's
 * under the lobby's scope in turn, with the organization's scope restored
 * after each.
 */
export const loadOrganizationGrantRows = async (
  tx: TabTransaction,
  scope: TenantScope,
  input: Parameters<typeof loadGrantRows>[1] & {
    readonly organizationId: string;
  },
): Promise<readonly GrantRow[]> => {
  const found = new Map(
    (await loadGrantRows(tx, input)).map((row) => [row.id, row]),
  );
  const owned = await tx
    .select({ id: lobbies.id })
    .from(lobbies)
    .where(eq(lobbies.ownerOrganizationId, input.organizationId))
    .orderBy(asc(lobbies.id));
  for (const lobby of owned) {
    const rows = await underLobbyScope(tx, scope, lobby.id, () =>
      loadGrantRows(tx, { ...input, lobbyId: lobby.id }),
    );
    for (const row of rows) found.set(row.id, row);
  }
  return [...found.values()].sort(byGrantedThenId);
};
