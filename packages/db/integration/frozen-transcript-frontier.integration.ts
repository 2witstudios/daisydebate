import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { captureSchemaStream } from './capture-schema.test-support';
import { rejectedBy, withFixture } from './constraint-helpers';
import {
  insertFrozenProofLine,
  writeBehindHolder,
} from './frozen-transcript.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('freeze and counter DML enforce the same immutable durable frontier (ISSUE-505 M1)', async () =>
  withFixture(databaseUrl, async (fixture) => {
    const stream = await captureSchemaStream(fixture);
    const frozen = stream.roundId;
    const source = await fixture.round();
    const zero = await fixture.round();
    const destination = await fixture.round();
    await insertFrozenProofLine(fixture.sql, stream);
    await fixture.sql`insert into round_transcripts(round_id,revision) values(${frozen},7),(${source},3)`;
    const mismatch = await rejectedBy(
      () =>
        fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${frozen},1,99,'incomplete')`,
    );
    await fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${frozen},1,7,'incomplete')`;
    await fixture.freeze(zero);
    const refused = await Promise.all([
      rejectedBy(
        () =>
          fixture.sql`update round_transcripts set revision=8 where round_id=${frozen}`,
      ),
      rejectedBy(
        () =>
          fixture.sql`delete from round_transcripts where round_id=${frozen}`,
      ),
      rejectedBy(
        () =>
          fixture.sql`update round_transcripts set round_id=${destination} where round_id=${frozen}`,
      ),
      rejectedBy(
        () =>
          fixture.sql`update round_transcripts set round_id=${zero} where round_id=${source}`,
      ),
      rejectedBy(
        () =>
          fixture.sql`insert into round_transcripts(round_id,revision) values(${zero},8)`,
      ),
    ]);
    await fixture.sql`delete from utterances where round_id=${frozen}`;
    const [state] = await fixture.sql`select
      (select revision from round_transcripts where round_id=${frozen}) as frozen,
      (select revision from round_transcripts where round_id=${source}) as source,
      (select revision from round_transcripts where round_id=${zero}) as zero,
      (select revision from round_transcripts where round_id=${destination}) as destination,
      (select frontier from round_transcript_freezes where round_id=${frozen}) as frontier`;
    assert({
      given:
        'a nonzero frozen counter, an absent-as-zero freeze, and raw mutation/move attempts',
      should:
        'reject every bypass and retain historical admission after lawful line deletion',
      actual: { mismatch, refused, state },
      expected: {
        mismatch: 'round_transcript_freezes_frontier_check',
        refused: Array<string>(5).fill('round_transcripts_frozen_check'),
        state: {
          frozen: 7,
          source: 3,
          zero: null,
          destination: null,
          frontier: 7,
        },
      },
    });
    await fixture.sql`delete from rounds where id=${frozen}`;
    assert({
      given:
        'owning-Round erasure with an immutable nonzero counter and freeze',
      should: 'cascade both protected rows',
      actual: [
        await fixture.count('round_transcripts', 'round_id', frozen),
        await fixture.count('round_transcript_freezes', 'round_id', frozen),
      ],
      expected: [0, 0],
    });
  }));

for (const [first, frontier] of [
  ['counter', 7],
  ['counter', 8],
  ['freeze', 7],
] as const)
  test(`${first} first serializes a counter write against freeze frontier ${frontier}`, async () =>
    withFixture(databaseUrl, async (fixture) => {
      const roundId = await fixture.round();
      await fixture.sql`insert into round_transcripts(round_id,revision) values(${roundId},7)`;
      const held = await fixture.sql.reserve();
      try {
        await held`begin isolation level read committed`;
        const [holder] = await held`select pg_backend_pid() as pid`;
        if (first === 'counter')
          await held`update round_transcripts set revision=8 where round_id=${roundId}`;
        else
          await held`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,7,'incomplete')`;
        const writing =
          first === 'counter'
            ? fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,${frontier},'incomplete')`
            : fixture.sql`update round_transcripts set revision=8 where round_id=${roundId}`;
        const { blocked, refusal } = await writeBehindHolder(
          fixture.sql,
          held,
          holder!.pid,
          writing,
        );
        const [state] = await fixture.sql`select
          (select revision from round_transcripts where round_id=${roundId}) as revision,
          (select frontier from round_transcript_freezes where round_id=${roundId}) as frontier`;
        assert({
          given:
            'a real parent-fence wait between counter mutation and freeze admission',
          should:
            'decide from the committed counter/freeze and preserve state on refusal',
          actual: { blocked, refusal, state },
          expected: {
            blocked: 'blocked',
            refusal:
              first === 'freeze'
                ? 'round_transcripts_frozen_check'
                : frontier === 7
                  ? 'round_transcript_freezes_frontier_check'
                  : null,
            state: {
              revision: first === 'counter' ? 8 : 7,
              frontier: first === 'counter' && frontier === 7 ? null : frontier,
            },
          },
        });
      } finally {
        await held`rollback`.catch(() => undefined);
        held.release();
      }
    }));

for (const isolation of ['repeatable read', 'serializable'] as const)
  for (const mutation of ['utterance', 'counter', 'freeze'] as const)
    test(`${isolation} stale-snapshot ${mutation} write is refused at the boundary (ISSUE-505 M2)`, async () =>
      withFixture(databaseUrl, async (fixture) => {
        const stream = await captureSchemaStream(fixture);
        const roundId = stream.roundId;
        await fixture.sql`insert into round_transcripts(round_id,revision) values(${roundId},7)`;
        const stale = await fixture.sql.reserve();
        try {
          await stale.unsafe(`begin isolation level ${isolation}`);
          await stale`select revision from round_transcripts where round_id=${roundId}`;
          if (mutation === 'freeze')
            await fixture.sql`update round_transcripts set revision=8 where round_id=${roundId}`;
          else
            await fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,7,'incomplete')`;
          const [view] = await stale`select
            (select revision from round_transcripts where round_id=${roundId}) as revision,
            (select count(*)::int from round_transcript_freezes where round_id=${roundId}) as freezes`;
          const refusal = await rejectedBy(async () => {
            if (mutation === 'utterance')
              await insertFrozenProofLine(stale, stream);
            else if (mutation === 'counter')
              await stale`update round_transcripts set revision=8 where round_id=${roundId}`;
            else
              await stale`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,7,'incomplete')`;
          });
          await stale`rollback`;
          const [state] = await fixture.sql`select
            (select revision from round_transcripts where round_id=${roundId}) as revision,
            (select count(*)::int from round_transcript_freezes where round_id=${roundId}) as freezes,
            (select count(*)::int from utterances where round_id=${roundId}) as lines`;
          assert({
            given:
              'a snapshot predating another connection’s committed freeze or counter update',
            should:
              'refuse unsupported isolation and commit no stale-snapshot mutation',
            actual: { view, refusal, state },
            expected: {
              view: { revision: 7, freezes: 0 },
              refusal: 'transcript_write_isolation_check',
              state: {
                revision: mutation === 'freeze' ? 8 : 7,
                freezes: mutation === 'freeze' ? 0 : 1,
                lines: 0,
              },
            },
          });
        } finally {
          await stale`rollback`.catch(() => undefined);
          stale.release();
        }
      }));
