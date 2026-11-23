import { seatKinds } from '@daisy/protocol/seats';
import { listedLiteral } from './lifecycle-sql';
import type { SQL } from 'bun';

/**
 * Private populated-predecessor proofs run today's adapters before the lineage migration.
 * These views expose the actual fixed identities that schema owns; they create no offers,
 * assignments, commands or timestamps. The nullable column is only a decoder interface.
 * Remove every loan before applying the real forward migration. Runtime never calls this.
 */
export async function loanRoundAssignmentInterface(client: SQL) {
  await client`alter table round_participants add column rating_actor_id text,add column legacy_rating_participant boolean not null default false`;
  await client.unsafe(`create function public.daisy_round_participant_is_current(target_participant_id text)
    returns boolean language sql stable as $$
      select exists(select 1 from public.round_participants where id=target_participant_id)
    $$`);
  await client.unsafe(
    `create view round_judge_slots as select round_id,slot,id participant_id from round_participants where seat_kind=${listedLiteral(seatKinds, 'judge')}`,
  );
  await client.unsafe(
    `create view round_finalization_judge_assignments as select f.round_id,p.id participant_id from round_finalizations f join round_participants p on p.round_id=f.round_id and p.seat_kind=${listedLiteral(seatKinds, 'judge')}`,
  );
  await client`create table round_source_voids(round_id text)`;
  await client`grant select on round_judge_slots,round_finalization_judge_assignments,round_source_voids to daisy_web`;
  return async () => {
    await client`drop view round_finalization_judge_assignments,round_judge_slots`;
    await client`drop table round_source_voids`;
    await client.unsafe(
      'drop function public.daisy_round_participant_is_current(text)',
    );
    await client`alter table round_participants drop column rating_actor_id,drop column legacy_rating_participant`;
  };
}
