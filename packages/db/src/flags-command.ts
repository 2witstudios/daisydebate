import { createAppError } from '@daisy/errors';
import {
  flagCommandResultSchema,
  type FlagChange,
  type FlagCommandResult,
} from '@daisy/protocol/flags';
import { sql } from 'drizzle-orm';
import { lockAuthorizationActors } from './authorization';
import {
  commandGate,
  storedResult,
  writeReceipt,
  type OperatorCommandTransaction,
} from './operator-command';
import { lockFlags } from './flags-lock';
import { readFlagSnapshot } from './flags-read';

export type FlagCommandInput = {
  readonly commandId: string;
  readonly serviceId: string;
  readonly operatorRef: string;
  readonly requestDigest: string;
  readonly adminAuditHead: string;
  readonly key: string;
  readonly change: FlagChange;
  readonly nextId: () => string;
  readonly live: () => boolean;
  readonly authorize: () => boolean;
  readonly decide: (
    revision: number,
    now: number,
  ) =>
    | { readonly kind: 'apply'; readonly revision: number }
    | { readonly kind: 'refused'; readonly reason: 'CONFLICT' | 'VALIDATION' };
};

async function lockTarget(tx: OperatorCommandTransaction, userId: string) {
  const [actor] = (await tx.execute(
    sql`select id from actors where user_id = ${userId} and kind = 'human'`,
  )) as unknown as { id: string }[];
  if (!actor) return null;
  const [account] = await lockAuthorizationActors(tx, [actor.id], {
    maxActors: 1,
  });
  return account ?? null;
}

/** Every change, its revision, audit and typed receipt commit together. */
export async function runFlagCommand(
  tx: OperatorCommandTransaction,
  input: FlagCommandInput,
): Promise<FlagCommandResult> {
  if (!input.authorize()) throw createAppError('AUTHORIZATION');
  await commandGate(tx, input.commandId);
  const target =
    input.change.action === 'flag.override.update'
      ? input.change.accountId
      : null;
  const account = target === null ? null : await lockTarget(tx, target);
  await lockFlags(tx, 'write');
  const replay = await storedResult(tx, input.commandId, input.requestDigest);
  if (replay) return flagCommandResultSchema.parse(replay);
  requireLiveTarget(target, account);
  const { snapshot, now } = await readFlagSnapshot(tx, target, [input.key]);
  const fact = snapshot.flags[0]!;
  const decision = input.decide(fact.revision, now);
  if (decision.kind === 'refused') throw createAppError(decision.reason);
  await persistChange(tx, input, fact.state, decision.revision, now);
  const result = flagCommandResultSchema.parse({
    commandId: input.commandId,
    key: input.key,
    revision: decision.revision,
  });
  await tx.execute(sql`insert into flag_change_events (id, key, revision, command_id, change)
    values (${input.nextId()}, ${input.key}, ${decision.revision}, ${input.commandId}, ${target === null ? 'state' : 'override'})`);
  await writeReceipt(tx, input, target, {
    action: input.change.action,
    result,
  });
  if (!input.live()) throw createAppError('CONFLICT');
  return result;
}

function requireLiveTarget(
  target: string | null,
  account: Awaited<ReturnType<typeof lockTarget>>,
) {
  if (target === null) return;
  if (!account || account.erased || account.userId !== target)
    throw createAppError('NOT_FOUND');
}
async function persistChange(
  tx: OperatorCommandTransaction,
  input: FlagCommandInput,
  state: string,
  revision: number,
  now: number,
) {
  await tx.execute(sql`insert into release_flags (key, state, revision)
    values (${input.key}, ${input.change.action === 'flag.state.update' ? input.change.state : state}, ${revision})
    on conflict (key) do update set state = excluded.state, revision = excluded.revision`);
  if (input.change.action === 'flag.override.update') {
    const { override, accountId } = input.change;
    if (override)
      await tx.execute(sql`insert into flag_account_overrides (key, user_id, enabled, expires_at, created_at)
      values (${input.key}, ${accountId}, ${override.enabled}, ${override.expiresAt}::timestamptz, ${new Date(now).toISOString()}::timestamptz)
      on conflict (key, user_id) do update set enabled = excluded.enabled, expires_at = excluded.expires_at, created_at = excluded.created_at`);
    else
      await tx.execute(
        sql`delete from flag_account_overrides where key = ${input.key} and user_id = ${accountId}`,
      );
  }
}
