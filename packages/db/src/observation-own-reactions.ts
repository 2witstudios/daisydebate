import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import type {
  ObservationAuthorityResult,
  ObservationBinding,
} from './observation-contracts';

type OwnReaction = { readonly messageId: string; readonly reaction: string };
/**
 * An allowed channel binding's private overlay: the viewer's own reactions for the messages in its
 * window, read once for the whole batch inside the fenced authority transaction.
 */
export async function attachOwnReactions(
  tx: Pick<BunSQLDatabase, 'execute'>,
  bindings: readonly ObservationBinding[],
  results: readonly ObservationAuthorityResult[],
): Promise<readonly ObservationAuthorityResult[]> {
  const wanted = bindings.flatMap((binding, index) =>
    results[index]?.status === 'allowed' && binding.resource.kind === 'channel'
      ? [{ index, binding }]
      : [],
  );
  if (!wanted.length) return results;
  const rows = (await tx.execute(
    sql`select binding, message_id as "messageId", reaction from public.daisy_observation_own_reactions(${JSON.stringify(
      wanted.map(({ binding }) => ({
        channel: binding.resource.id,
        actor: binding.principal.actorId,
        before: binding.window.after,
        limit: binding.window.limit,
      })),
    )}::text::jsonb)`,
  )) as unknown as { binding: number; messageId: string; reaction: string }[];
  const own = new Map<number, OwnReaction[]>(
    wanted.map(({ index }) => [index, []]),
  );
  for (const row of rows) {
    const target = wanted[row.binding];
    if (!target) throw createAppError('INFRASTRUCTURE');
    own.get(target.index)!.push({
      messageId: row.messageId,
      reaction: row.reaction,
    });
  }
  return results.map((result, index) =>
    result.status === 'allowed' && own.has(index)
      ? { ...result, overlay: { ownReactions: own.get(index)! } }
      : result,
  );
}
