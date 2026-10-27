import type { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { finishedOrBlockedBehind } from '../src/testing';
import { captureSchemaStream } from './capture-schema.test-support';
import { rejectedBy, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const insertLine = (
  client: Pick<SQL, 'unsafe'>,
  stream: Awaited<ReturnType<typeof captureSchemaStream>>,
  sequence = 0,
  id = createId(),
) =>
  client.unsafe(
    'insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text) values($1,$2,$3,$4,$5,$6)',
    [
      id,
      stream.roundId,
      stream.segmentId,
      stream.seat.id,
      sequence,
      'Frozen proof',
    ],
  );

test('raw SQL cannot alter frozen input or remove its freeze, while lawful erasure remains possible (ISSUE-505)', async () =>
  withFixture(databaseUrl, async (fixture) => {
    const frozen = await captureSchemaStream(fixture);
    const open = await captureSchemaStream(fixture);
    const frozenLine = createId(),
      openLine = createId();
    await insertLine(fixture.sql, frozen, 0, frozenLine);
    await insertLine(fixture.sql, open, 0, openLine);
    await fixture.freeze(frozen.roundId);
    const move = (id: string, destination: typeof open) =>
      fixture.sql.unsafe(
        'update utterances set round_id=$1,segment_id=$2,round_participant_id=$3,sequence=1 where id=$4',
        [destination.roundId, destination.segmentId, destination.seat.id, id],
      );
    const refusals = await Promise.all([
      rejectedBy(() => insertLine(fixture.sql, frozen, 1)),
      rejectedBy(
        () =>
          fixture.sql`update utterances set text='changed' where id=${frozenLine}`,
      ),
      rejectedBy(() => move(frozenLine, open)),
      rejectedBy(() => move(openLine, frozen)),
      rejectedBy(
        () =>
          fixture.sql`delete from round_transcript_freezes where round_id=${frozen.roundId}`,
      ),
    ]);
    assert({
      given:
        'frozen text with no ballot references and a valid unfrozen destination',
      should:
        'refuse insert, text mutation, both movement directions and direct freeze deletion',
      actual: refusals,
      expected: [
        ...Array<string>(4).fill('utterances_frozen_transcript_check'),
        'round_transcript_freezes_immutable',
      ],
    });
    const [retained] =
      await fixture.sql`select text from utterances where id=${frozenLine}`;
    await fixture.sql`delete from utterances where id=${frozenLine}`;
    await fixture.sql`delete from rounds where id=${frozen.roundId}`;
    assert({
      given:
        'all attempted rewrites refused, then lawful line and owning-Round erasure',
      should: 'preserve the text until erasure and allow the aggregate cascade',
      actual: {
        text: retained!.text,
        lines: await fixture.count('utterances', 'round_id', frozen.roundId),
        freezes: await fixture.count(
          'round_transcript_freezes',
          'round_id',
          frozen.roundId,
        ),
      },
      expected: { text: 'Frozen proof', lines: 0, freezes: 0 },
    });
  }));

for (const first of ['utterance', 'freeze'] as const)
  test(`${first} first serializes raw transcript freezing against insertion`, async () =>
    withFixture(databaseUrl, async (fixture) => {
      const stream = await captureSchemaStream(fixture);
      const held = await fixture.sql.reserve();
      try {
        await held`begin`;
        const [holder] = await held`select pg_backend_pid() as pid`;
        if (first === 'utterance') await insertLine(held, stream);
        else
          await held`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${stream.roundId},1,0,'incomplete')`;
        const next =
          first === 'utterance'
            ? fixture.freeze(stream.roundId)
            : insertLine(fixture.sql, stream);
        const result = rejectedBy(() => next);
        const blocked = await finishedOrBlockedBehind(
          next,
          fixture.sql,
          holder!.pid,
          { now: performance.now },
        );
        await held`commit`;
        assert({
          given: `an uncommitted ${first} and its concurrent counterpart`,
          should:
            'wait for the parent fence and decide from the committed freeze',
          actual: {
            blocked,
            refusal: await result,
            lines: await fixture.count(
              'utterances',
              'round_id',
              stream.roundId,
            ),
            freezes: await fixture.count(
              'round_transcript_freezes',
              'round_id',
              stream.roundId,
            ),
          },
          expected: {
            blocked: 'blocked',
            refusal:
              first === 'utterance'
                ? null
                : 'utterances_frozen_transcript_check',
            lines: first === 'utterance' ? 1 : 0,
            freezes: 1,
          },
        });
      } finally {
        await held`rollback`.catch(() => undefined);
        held.release();
      }
    }));
