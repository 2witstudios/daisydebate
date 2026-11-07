import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { lockFlags } from './flags-lock';

/** The caller already holds this subject's canonical account fence. */
export const flagsPrivacyAdopter: PrivacyAdopter = {
  id: 'flags',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await lockFlags(tx, 'write');
    await tx.execute(sql`with removed as (
      delete from flag_account_overrides where user_id = ${subject.userId} returning key
    ) update release_flags set revision = revision + 1 where key in (select key from removed)`);
    await tx.execute(
      sql`select public.daisy_erase_flag_subject(${subject.userId})`,
    );
  },
  export: async (tx, subject) => {
    const targeting = await tx.execute(sql`select key, enabled,
      to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at
      from flag_account_overrides where user_id = ${subject.userId} order by key`);
    const commands = await tx.execute(sql`select command_id, action, result,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from operator_command_receipts where target_user_id = ${subject.userId}
      and action in ('flag.state.update', 'flag.override.update') order by created_at, command_id`);
    return {
      flag_account_overrides: targeting as unknown as Record<string, unknown>[],
      flag_commands: commands as unknown as Record<string, unknown>[],
    };
  },
};
