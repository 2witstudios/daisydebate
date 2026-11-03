import { afterAll } from 'bun:test';
import { requireTestServices } from '@daisy/config';
import { roundRulesSchema } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { validConfig, validRules } from './round-fixtures';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const migration = '20261103021729_round_stage_and_interruption_rule';
const scratch = scratchDatabase(databaseUrl, 'interruptionruleit');
afterAll(() => scratch.drop());

const storedRules = (interruptions: unknown) => ({
  ...validRules,
  interaction: { ...validRules.interaction, interruptions },
});

test(
  'stored rules take the interruption union and an ended debate its own stage',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const stored = [
        [null, { allowed: 'disabled' }],
        [
          { allowed: 'disabled', minRemainingMs: 30_000 },
          { allowed: 'disabled' },
        ],
        [{ allowed: 'open', minRemainingMs: 0 }, { allowed: 'open' }],
        [
          { allowed: 'enabled', minRemainingMs: 30_000 },
          { allowed: 'enabled', minRemainingMs: 30_000 },
        ],
      ] as const;
      const actor = await f.actor();
      const format = await f.format();
      const rooms = [];
      const rounds = [];
      for (const [before] of stored) {
        const room = await f.room(actor, format, {
          config: validConfig,
          rules_snapshot: storedRules(before),
        });
        rooms.push(room);
        rounds.push(
          await f.round({
            room_id: room,
            rules_snapshot: storedRules(before),
            created_by_actor_id: actor,
            format_id: format,
          }),
        );
      }
      const ended = await f.round({
        status: 'active',
        current_stage: 'live',
        started_at: new Date(),
      });
      const speaking = await f.round({
        status: 'active',
        current_stage: 'live',
        started_at: new Date(),
      });
      await f.sql`update rounds set final_segment_ended_at = statement_timestamp(),
        transcript_admission_cutoff = statement_timestamp() + interval '120 seconds',
        attendance_resolution_cutoff_at = statement_timestamp() + interval '60 minutes'
        where id = ${ended}`;

      await scratch.migrate((folder) => folder <= migration);

      const ruleOf = async (table: 'rooms' | 'rounds', id: string) => {
        const [row] =
          table === 'rooms'
            ? await f.sql`select rules_snapshot from rooms where id = ${id}`
            : await f.sql`select rules_snapshot from rounds where id = ${id}`;
        return row.rules_snapshot;
      };
      for (const [index, [before, after]] of stored.entries()) {
        const rules = [
          await ruleOf('rooms', rooms[index]!),
          await ruleOf('rounds', rounds[index]!),
        ];
        assert({
          given: `a stored interruption rule of ${JSON.stringify(before)}`,
          should: 'hold the one spelling and parse under the contract',
          actual: rules.map((rule) => [
            rule.interaction.interruptions,
            roundRulesSchema.safeParse(rule).success,
          ]),
          expected: [
            [after, true],
            [after, true],
          ],
        });
      }
      const stageOf = async (id: string) =>
        (await f.sql`select current_stage from rounds where id = ${id}`)[0]
          .current_stage;
      assert({
        given: 'an active Round past its last segment and one still speaking',
        should: 'move only the ended debate to awaiting its ballot',
        actual: [await stageOf(ended), await stageOf(speaking)],
        expected: ['awaiting_ballot', 'live'],
      });
    });
  },
  ddlTimeoutMs,
);
