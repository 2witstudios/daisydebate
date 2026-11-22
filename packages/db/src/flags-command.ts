import { createAppError } from '@daisy/errors';
import {
  flagCommandResultSchema,
  type FlagChange,
  type FlagState,
  type FlagCommandResult,
} from '@daisy/protocol/flags';
import { sql } from 'drizzle-orm';
import { lockAuthorizationActors } from './authorization';
import { commandGate, storedResult, writeReceipt } from './operator-command';
import { lockFlags } from './flags-lock';
import { readFlagSnapshot } from './flags-read';
import type { Tx } from './tx';
import { run, query } from './raw-rows';
import { z } from 'zod';

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
};

async function lockTarget(tx: Tx, userId: string) {
  const [actor] = await query(
    tx,
    z.object({ id: z.string() }),
    sql`select id from actors where user_id = ${userId} and kind = 'human'`,
  );
  if (!actor) return null;
  const [account] = await lockAuthorizationActors(tx, [actor.id], {
    maxActors: 1,
  });
  return account ?? null;
}

type FlagCommandLoad =
  | { readonly kind: 'replayed'; readonly result: FlagCommandResult }
  | {
      readonly kind: 'fresh';
      readonly state: FlagState;
      readonly revision: number;
      readonly now: number;
      readonly apply: (revision: number) => Promise<FlagCommandResult>;
    };

export type FlagCommandSession = {
  readonly load: () => Promise<FlagCommandLoad>;
};
export type FlagCommandWork = (
  session: FlagCommandSession,
) => Promise<FlagCommandResult>;

/** One transaction's fenced Flags facts and atomic writer, with application-owned policy. */
export async function inFlagCommand(
  tx: Tx,
  input: FlagCommandInput,
  work: FlagCommandWork,
): Promise<FlagCommandResult> {
  let phase: 'new' | 'loading' | 'fresh' | 'applying' | 'settled' | 'closed' =
    'new';
  const isSettled = () => phase === 'settled';
  const load = async (): Promise<FlagCommandLoad> => {
    if (phase !== 'new') throw createAppError('INVARIANT');
    phase = 'loading';
    await commandGate(tx, input.commandId);
    const target =
      input.change.action === 'flag.override.update'
        ? input.change.accountId
        : null;
    const account = target === null ? null : await lockTarget(tx, target);
    await lockFlags(tx, 'write');
    requireLiveTarget(target, account);
    const replay = await storedResult(tx, input.commandId, input.requestDigest);
    if (replay) {
      const result = flagCommandResultSchema.parse(replay);
      phase = 'settled';
      return { kind: 'replayed', result };
    }
    const { snapshot, now } = await readFlagSnapshot(tx, target, [input.key]);
    const fact = snapshot.flags[0]!;
    phase = 'fresh';
    return {
      kind: 'fresh',
      state: fact.state,
      revision: fact.revision,
      now,
      apply: async (revision) => {
        if (phase !== 'fresh') throw createAppError('INVARIANT');
        phase = 'applying';
        await persistChange(tx, input, fact.state, revision, now);
        const result = flagCommandResultSchema.parse({
          commandId: input.commandId,
          key: input.key,
          revision,
        });
        await run(
          tx,
          sql`insert into flag_change_events (id, key, revision, command_id, change)
          values (${input.nextId()}, ${input.key}, ${revision}, ${input.commandId}, ${target === null ? 'state' : 'override'})`,
        );
        await writeReceipt(tx, input, target, {
          action: input.change.action,
          result,
        });
        if (!input.live()) throw createAppError('CONFLICT');
        phase = 'settled';
        return result;
      },
    };
  };
  try {
    const result = await work({ load });
    if (!isSettled()) throw createAppError('INVARIANT');
    return result;
  } finally {
    phase = 'closed';
  }
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
  tx: Tx,
  input: FlagCommandInput,
  state: string,
  revision: number,
  now: number,
) {
  await run(
    tx,
    sql`insert into release_flags (key, state, revision)
    values (${input.key}, ${input.change.action === 'flag.state.update' ? input.change.state : state}, ${revision})
    on conflict (key) do update set state = excluded.state, revision = excluded.revision`,
  );
  if (input.change.action === 'flag.override.update') {
    const { override, accountId } = input.change;
    if (override)
      await run(
        tx,
        sql`insert into flag_account_overrides (key, user_id, enabled, expires_at, created_at)
      values (${input.key}, ${accountId}, ${override.enabled}, ${override.expiresAt}::timestamptz, ${new Date(now).toISOString()}::timestamptz)
      on conflict (key, user_id) do update set enabled = excluded.enabled, expires_at = excluded.expires_at, created_at = excluded.created_at`,
      );
    else
      await run(
        tx,
        sql`delete from flag_account_overrides where key = ${input.key} and user_id = ${accountId}`,
      );
  }
}
