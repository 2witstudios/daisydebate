import { sql, type SQL } from 'drizzle-orm';
import { ageBands } from '@daisy/protocol';
import {
  friendApprovalLimits,
  friendRequestNeedsGuardian,
  protectionLevels,
  protectionLimits,
} from '@daisy/protocol/protection-level';

const directions = ['incoming', 'outgoing'] as const;

const presets = protectionLevels.flatMap((level) =>
  level === 'custom'
    ? []
    : [sql`when ${level} then ${protectionLimits({ level }).friendApproval}`],
);

const holds = friendApprovalLimits.flatMap((approval) =>
  directions.flatMap((direction) =>
    [...ageBands, null].flatMap((age) =>
      friendRequestNeedsGuardian(approval, direction, age)
        ? [sql`(${approval}::text, ${direction}::text, ${age ?? ''}::text)`]
        : [],
    ),
  ),
);

/** SQL reads use the truth table from the protocol rule, including Custom's choice. */
export const liveGuardianHold = (approval: SQL, friendship: SQL) => sql`(
  not ${approval}.cleared and exists (
    select 1
    from actors protected_child
    join actors counterpart on counterpart.id = case
      when ${approval}.low_actor_id = protected_child.id
        then ${approval}.high_actor_id else ${approval}.low_actor_id end
    join users counterpart_user on counterpart_user.id = counterpart.user_id
      and counterpart_user.deleted_at is null
    left join account_age counterpart_age on counterpart_age.user_id = counterpart_user.id
    cross join lateral (select public.daisy_protection_level(protected_child.user_id) as choice) level
    join (values ${sql.join(holds, sql`, `)}) eligible(approval, direction, age)
      on eligible.approval = case level.choice->>'level'
        ${sql.join(presets, sql` `)}
        when 'custom' then level.choice->>'friendApproval' end
      and eligible.direction = case when ${friendship}.requester_actor_id = protected_child.id
        then 'outgoing' else 'incoming' end
      and eligible.age = coalesce(public.daisy_age_band(
        counterpart_age.birth_month, counterpart_age.version,
        counterpart_age.recorded_at, statement_timestamp()), '')
    where protected_child.id = ${approval}.child_actor_id
  )
)`;
