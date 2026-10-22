import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src/index';
import { withFixture, type Fixture } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

async function seedTranscript(fixture: Fixture, frozen: boolean) {
  const roundId = await fixture.round({
    status: 'active',
    current_stage: 'live',
    started_at: new Date(),
  });
  const seat = await fixture.seat(roundId, 'affirmative');
  const segmentId = createId(),
    id = createId(),
    appendedId = createId();
  const token = randomBytes(32).toString('base64url');
  await fixture.insert('round_segments', {
    id: segmentId,
    round_id: roundId,
    sequence: 0,
    type: 'speech',
    rules_segment_key: 'AC',
    started_at: new Date(),
    duration_ms: 240000,
  });
  await fixture.insert('utterances', {
    id,
    round_id: roundId,
    segment_id: segmentId,
    round_participant_id: seat.id,
    sequence: 0,
    text: 'Durable capture',
    complete: false,
    generation_token: token,
    generation_expires_at: new Date(Date.now() + 120000),
  });
  await fixture.sql`insert into round_transcripts(round_id,revision) values(${roundId},1)`;
  if (frozen)
    await fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,1,'incomplete')`;
  fixture.track('utterances', appendedId);
  return { roundId, seat, segmentId, id, appendedId, token };
}

for (const frozen of [false, true]) {
  test(`unscoped retained writers cannot mutate ${frozen ? 'frozen' : 'unanchored'} transcript state`, async () =>
    withFixture(url, async (fixture) => {
      const { roundId, seat, segmentId, id, appendedId, token } =
        await seedTranscript(fixture, frozen);
      const store = createDatabase({ url, nextActorId: createId });
      const snapshot = async () => {
        const lines =
          await fixture.sql`select id,text,complete,generation_token,generation_expires_at from utterances where round_id=${roundId} order by sequence`;
        const frontier =
          await fixture.sql`select revision from round_transcripts where round_id=${roundId}`;
        const freeze =
          await fixture.sql`select revision,frontier,completeness,frozen_at from round_transcript_freezes where round_id=${roundId}`;
        return {
          lines: [...lines],
          frontier: [...frontier],
          freeze: [...freeze],
        };
      };
      try {
        const before = await snapshot();
        const writes = [
          () =>
            store.appendUtterance({
              id: appendedId,
              roundId,
              segmentId,
              roundParticipantId: seat.id,
              text: 'Unscoped append',
              requireOpen: false,
            }),
          () =>
            store.appendUtterance({
              id: appendedId,
              roundId,
              segmentId,
              roundParticipantId: seat.id,
              text: 'Unscoped open append',
              requireOpen: true,
            }),
          () =>
            store.replaceUtterance({
              id,
              roundId,
              text: 'Unscoped replacement',
              requireOpen: false,
            }),
          () =>
            store.replaceUtterance({
              id,
              roundId,
              text: 'Claimed replacement',
              requireOpen: true,
              speechToken: token,
            }),
          () =>
            store.claimSpeech({
              id: appendedId,
              roundId,
              segmentId,
              roundParticipantId: seat.id,
              token,
            }),
          () => store.releaseSpeech({ utteranceId: id, roundId, token }),
        ];
        for (const write of writes)
          await assertRejects({
            given: `${frozen ? 'immutable freeze' : 'no durable final-end anchor'} and no signed capture authority`,
            should: 'truthfully refuse every retained text or claim mutation',
            actual: write,
            code: 'CONFLICT',
          });
        assert({
          given: 'all retained unscoped mutation attempts',
          should:
            'preserve utterances, claim ownership, frontier and freeze byte facts',
          actual: await snapshot(),
          expected: before,
        });
      } finally {
        await store.close();
        await fixture.sql`delete from rounds where id=${roundId}`;
      }
    }));
}
