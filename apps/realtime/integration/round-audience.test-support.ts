import type { SQL } from 'bun';
import { systemId } from '@daisy/clock';
import { validRules } from '@daisy/db/testing';
import {
  buildRoundTopic,
  emptyRuntimeCheckpointFor,
  sideOfSeat,
  type SeatRef,
} from '@daisy/protocol';

/** Administrative fixture writes persist facts; production canonical readers decide. */
export function roundAudienceFixture(client: SQL, actorId: string) {
  const ids: string[] = [];
  return {
    async seed(visibility: 'public' | 'private', seat?: SeatRef) {
      const id = systemId.next();
      const [format] =
        await client`select id,current_version from formats where created_by_actor_id is null order by id limit 1`;
      if (!format) throw new Error('Migrated reference format unavailable');
      await client`insert into rounds(id,visibility,resolution,competition_type,format_id,format_version,rules_snapshot,runtime_state,status)
        values(${id},${visibility},'Isolated realtime audience proof','casual',${format.id},${format.current_version},${validRules}::jsonb,${emptyRuntimeCheckpointFor(validRules)}::jsonb,'opening')`;
      ids.push(id);
      if (seat)
        await client`insert into round_participants(id,round_id,actor_id,seat_kind,side,slot) values(${systemId.next()},${id},${actorId},${seat.kind},${sideOfSeat(seat)},${seat.slot})`;
      return { id, topic: buildRoundTopic(id) };
    },
    async close() {
      for (const id of ids) {
        await client`delete from round_participants where round_id=${id}`;
        await client`delete from rounds where id=${id}`;
      }
    },
  };
}
