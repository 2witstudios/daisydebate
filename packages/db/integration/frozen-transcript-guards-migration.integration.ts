import { afterAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { captureSchemaStream } from './capture-schema.test-support';
import { rejectedBy, withFixture } from './constraint-helpers';
import { insertFrozenProofLine } from './frozen-transcript.test-support';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261027160753_frozen_transcript_guards';
const scratch = scratchDatabase(url, 'frozenguardit');

afterAll(() => scratch.drop());

test(
  'the frozen transcript guard folder refuses a mismatched predecessor freeze atomically, installs once repaired, then reruns as a no-op (ISSUE-505)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const ledger = async () =>
        (
          await f.sql`select count(*)::int as n from drizzle.__drizzle_migrations`
        )[0].n as number;
      const guards = async () =>
        (
          await f.sql`select
            (select count(*)::int from pg_proc where proname='refuse_round_transcript_freeze_update') as old,
            (select count(*)::int from pg_proc where proname in
              ('guard_round_transcript_freeze','guard_frozen_utterance_write','guard_frozen_transcript_counter','require_transcript_write_isolation','refuse_transcript_truncate')) as new`
        )[0] as { old: number; new: number };
      const kept = await captureSchemaStream(f);
      await insertFrozenProofLine(f.sql, kept, 0);
      await f.sql`insert into round_transcripts(round_id,revision) values(${kept.roundId},3)`;
      await f.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${kept.roundId},1,3,'complete')`;
      const mismatched = await captureSchemaStream(f);
      await f.sql`insert into round_transcripts(round_id,revision) values(${mismatched.roundId},2)`;
      await f.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${mismatched.roundId},1,5,'incomplete')`;
      const before = await ledger();
      // One at a time: TRUNCATE takes ACCESS EXCLUSIVE before its trigger runs.
      const truncations = async () => {
        const refused: (string | null)[] = [];
        for (const table of [
          'utterances',
          'round_transcripts',
          'round_transcript_freezes',
        ])
          refused.push(
            await rejectedBy(() => f.sql.unsafe(`truncate ${table} cascade`)),
          );
        return refused;
      };

      const refusal = await scratch
        .migrate(() => true)
        .then(
          () => 'applied',
          (error: unknown) => {
            const { message, cause } = error as Error & { cause?: Error };
            return `${message} ${cause?.message ?? ''}`;
          },
        );
      const afterRefusal = { ledger: await ledger(), guards: await guards() };
      assert({
        given:
          'a predecessor database holding a freeze whose frontier differs from its counter',
        should:
          'stop before replacing any guard, leaving the predecessor trigger and no ledger row',
        actual: {
          refused: refusal.includes('requires an adjudicated repair'),
          ...afterRefusal,
        },
        expected: {
          refused: true,
          ledger: before,
          guards: { old: 1, new: 0 },
        },
      });

      // The adjudicated repair the preflight asks for; the predecessor guard
      // only refuses UPDATE, so this deletion is the operator's decision.
      await f.sql`delete from round_transcript_freezes where round_id=${mismatched.roundId}`;
      // Later folders are not this guard's ledger row.
      const throughGuard = (folder: string) => folder <= migration;
      await scratch.migrate(throughGuard);
      const installed = { ledger: await ledger(), guards: await guards() };
      await scratch.migrate(throughGuard);
      const [freeze] =
        await f.sql`select frontier, completeness from round_transcript_freezes where round_id=${kept.roundId}`;
      assert({
        given: 'the repaired predecessor, the guard folder, then a second run',
        should:
          'install every guard once, preserve the consistent frozen evidence and record one ledger row',
        actual: {
          installed,
          rerunLedger: await ledger(),
          freeze,
          frozenWrite: await rejectedBy(() =>
            insertFrozenProofLine(f.sql, kept, 1),
          ),
          frozenCounter: await rejectedBy(
            () =>
              f.sql`update round_transcripts set revision=4 where round_id=${kept.roundId}`,
          ),
          truncate: await truncations(),
        },
        expected: {
          installed: { ledger: before + 1, guards: { old: 0, new: 5 } },
          rerunLedger: before + 1,
          freeze: { frontier: 3, completeness: 'complete' },
          frozenWrite: 'utterances_frozen_transcript_check',
          frozenCounter: 'round_transcripts_frozen_check',
          truncate: Array.from(
            { length: 3 },
            () => 'transcript_truncate_check',
          ),
        },
      });
    });
  },
  { timeout: ddlTimeoutMs * 3 },
);
