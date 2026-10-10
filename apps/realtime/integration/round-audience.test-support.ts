import type { SQL } from 'bun';
import { systemId } from '@daisy/clock';
import { validRules } from '@daisy/db/testing';
import { buildDebateTopic, type DebateRole } from '@daisy/protocol';

/** Administrative fixture writes persist facts; production canonical readers decide. */
export function roundAudienceFixture(client: SQL, actorId: string) {
  const ids: string[] = [];
  return {
    async seed(visibility: 'public' | 'private', role?: DebateRole) {
      const id = systemId.next();
      const [format] =
        await client`select id,current_version from formats where created_by_actor_id is null order by id limit 1`;
      if (!format) throw new Error('Migrated reference format unavailable');
      await client`insert into rounds(id,visibility,resolution,competition_type,length,format_id,format_version,rules_snapshot,status)
        values(${id},${visibility},'Isolated realtime audience proof','casual','full',${format.id},${format.current_version},${JSON.stringify(validRules)}::jsonb,'scheduled')`;
      ids.push(id);
      if (role)
        await client`insert into round_participants(id,round_id,actor_id,role,slot) values(${systemId.next()},${id},${actorId},${role},0)`;
      return { id, topic: buildDebateTopic(id) };
    },
    async close() {
      for (const id of ids) {
        await client`delete from round_participants where round_id=${id}`;
        await client`delete from rounds where id=${id}`;
      }
    },
  };
}
