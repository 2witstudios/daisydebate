import type { SQL } from 'bun';
import { systemId } from '@daisy/clock';
import { fixtureRules, oneOnOneFormatFixture } from '@daisy/protocol/testing';
import {
  buildRoundTopic,
  emptyRuntimeCheckpointFor,
  sideOfSeat,
  roundJudgeAssignmentReceiptSchema,
  type SeatRef,
} from '@daisy/protocol';

/** Administrative fixture writes persist facts; production canonical readers decide. */
export function roundAudienceFixture(client: SQL, actorId: string) {
  const ids: string[] = [];
  const formats: string[] = [];
  return {
    async seed(visibility: 'public' | 'private', seat?: SeatRef) {
      const id = systemId.next();
      const formatId = systemId.next();
      const definition = {
        ...oneOnOneFormatFixture,
        seats: {
          ...oneOnOneFormatFixture.seats,
          judges: seat?.kind === 'judge' ? seat.slot + 1 : 0,
        },
      };
      const rules = fixtureRules(definition);
      formats.push(formatId);
      await client`insert into format_revisions(format_id,version,definition) values(${formatId},1,${definition})`;
      await client`insert into formats(id,name,current_version) values(${formatId},'Native audience fixture',1)`;
      await client`insert into rounds(id,visibility,resolution,competition_type,format_id,format_version,rules_snapshot,runtime_state,status)
        values(${id},${visibility},'Isolated realtime audience proof','casual',${formatId},1,${rules}::jsonb,${emptyRuntimeCheckpointFor(rules)}::jsonb,'opening')`;
      ids.push(id);
      if (seat)
        await client`insert into round_participants(id,round_id,actor_id,seat_kind,side,slot) values(${systemId.next()},${id},${actorId},${seat.kind},${sideOfSeat(seat)},${seat.slot})`;
      return { id, topic: buildRoundTopic(id) };
    },
    async unassignJudge(tx: SQL, roundId: string) {
      const [round] =
        await tx`select version from rounds where id=${roundId} for no key update`;
      const [slot] =
        await tx`select current_version from round_judge_slots where round_id=${roundId} and slot=0 for update`;
      if (!round || !slot) throw new Error('Actual judge assignment missing');
      const commandId = systemId.next();
      const receipt = roundJudgeAssignmentReceiptSchema.parse({
        kind: 'judge_assignment',
        commandId,
        roundId,
        slot: 0,
        assignmentVersion: Number(slot.current_version) + 1,
        participantId: null,
        resultingVersion: Number(round.version) + 1,
        replayed: false,
      });
      const digest = new Bun.CryptoHasher('sha3-256')
        .update(JSON.stringify(receipt))
        .digest('hex');
      await tx`insert into round_commands(command_id,round_id,actor_id,type,payload_digest,result,resulting_version,applied_at) values(${commandId},${roundId},${actorId},'change_judge',${digest},${receipt},${receipt.resultingVersion},date_trunc('milliseconds',clock_timestamp()))`;
      await tx`select public.daisy_append_round_judge_assignment(${roundId},0,${Number(round.version)},${Number(slot.current_version)},null,${commandId})`;
    },
    async close() {
      for (const id of ids) {
        await client`delete from rounds where id=${id}`;
      }
      for (const id of formats) {
        await client`delete from formats where id=${id}`;
        await client`delete from format_revisions where format_id=${id}`;
      }
    },
  };
}
