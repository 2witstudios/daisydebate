import { afterAll } from 'bun:test';
import { requireTestServices } from '@daisy/config';
import {
  formatDefinitionSchema,
  formatSettingsSchema,
  roomConfigSchema,
  roundRulesSchema,
} from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { validConfig, validRules } from './round-fixtures';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const migration = '20261102041427_cross_ex_open_mics';
const scratch = scratchDatabase(databaseUrl, 'crossexmicsit');
afterAll(() => scratch.drop());

const staleConfig = (mode: string) => ({
  ...validConfig,
  crossExamination: { crossExMode: 'ordered' },
  interruptions: { mode, minRemainingMs: 30_000 },
});
const staleRules = (allowed: string) => ({
  ...validRules,
  interaction: {
    ...validRules.interaction,
    crossExMode: 'ordered',
    interruptions: { allowed, minRemainingMs: 30_000 },
  },
});
const parses = (
  schema: { safeParse: (value: unknown) => { success: boolean } },
  values: readonly unknown[],
) => values.length > 0 && values.every((v) => schema.safeParse(v).success);

test(
  'the migration removes the cross-examination settings from every stored shape',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const actor = await f.actor();
      const format = await f.format();
      const room = (mode: string, allowed: string) =>
        f.room(actor, format, {
          config: staleConfig(mode),
          rules_snapshot: staleRules(allowed),
        });
      const round = (mode: string, allowed: string, roomId: string) =>
        f.round({
          room_id: roomId,
          room_config_snapshot: staleConfig(mode),
          rules_snapshot: staleRules(allowed),
          visibility: 'public',
          created_by_actor_id: actor,
          format_id: format,
        });
      const retiredRoom = await room('cross_ex_only', 'cross_ex_only');
      const keptRoom = await room('enabled', 'enabled');
      const retiredRound = await round(
        'cross_ex_only',
        'cross_ex_only',
        retiredRoom,
      );
      const keptRound = await round('open', 'open', keptRoom);
      const [seeded] = await f.sql`select
        (select count(*)::int from format_revisions
          where definition #> '{configurable,interaction}' ? 'crossExModes') as revisions,
        (select count(*)::int from format_presets
          where config ? 'crossExamination') as presets`;
      assert({
        given: 'the predecessor database',
        should: 'hold seeded formats and presets naming the retired settings',
        actual: seeded.revisions > 0 && seeded.presets > 0,
        expected: true,
      });

      const active = await f.round({
        status: 'active',
        current_stage: 'countdown',
        started_at: new Date(),
      });
      const refused = await scratch
        .migrate((folder) => folder <= migration)
        .then(
          () => '',
          (error: unknown) => String(error),
        );
      assert({
        given: 'an active Round when the release migrates',
        should: 'refuse and leave the predecessor rows in place',
        actual: {
          refused: refused.includes('active Rounds'),
          retiredNamed: JSON.stringify(
            await f.sql`select rules_snapshot from rounds where id = ${retiredRound}`,
          ).includes('cross_ex_only'),
        },
        expected: { refused: true, retiredNamed: true },
      });
      await f.sql`delete from rounds where id = ${active}`;

      await scratch.migrate((folder) => folder <= migration);
      await scratch.migrate((folder) => folder <= migration);

      const revisions =
        await f.sql`select definition from format_revisions order by format_id, version`;
      const presets =
        await f.sql`select config from format_presets order by format_id, version`;
      const rooms =
        await f.sql`select id, config, rules_snapshot from rooms order by id`;
      const rounds =
        await f.sql`select id, room_config_snapshot, rules_snapshot from rounds order by id`;
      const stored = JSON.stringify([revisions, presets, rooms, rounds]);
      assert({
        given: 'every format, preset, Room and Round after the migration',
        should: 'name no retired setting and parse under the current contracts',
        actual: {
          retiredNamed: /crossEx|cross_ex_only/.test(stored),
          revisions: parses(
            formatDefinitionSchema,
            [...revisions].map((row) => row.definition),
          ),
          presets: parses(
            formatSettingsSchema,
            [...presets].map((row) => row.config),
          ),
          roomConfigs: parses(
            roomConfigSchema,
            [...rooms].map((row) => row.config),
          ),
          roomRules: parses(
            roundRulesSchema,
            [...rooms].map((row) => row.rules_snapshot),
          ),
          roundConfigs: parses(
            roomConfigSchema,
            [...rounds].map((row) => row.room_config_snapshot),
          ),
          roundRules: parses(
            roundRulesSchema,
            [...rounds].map((row) => row.rules_snapshot),
          ),
        },
        expected: {
          retiredNamed: false,
          revisions: true,
          presets: true,
          roomConfigs: true,
          roomRules: true,
          roundConfigs: true,
          roundRules: true,
        },
      });

      const roomOf = (id: string) => [...rooms].find((row) => row.id === id);
      const roundOf = (id: string) => [...rounds].find((row) => row.id === id);
      assert({
        given: 'stored interruption policies after the migration',
        should:
          'turn cross_ex_only off and keep the speech policies as they were',
        actual: {
          retiredRoom: [
            roomOf(retiredRoom).config.interruptions.mode,
            roomOf(retiredRoom).rules_snapshot.interaction.interruptions
              .allowed,
          ],
          keptRoom: [
            roomOf(keptRoom).config.interruptions.mode,
            roomOf(keptRoom).rules_snapshot.interaction.interruptions.allowed,
          ],
          retiredRound: [
            roundOf(retiredRound).room_config_snapshot.interruptions.mode,
            roundOf(retiredRound).rules_snapshot.interaction.interruptions
              .allowed,
          ],
          keptRound: [
            roundOf(keptRound).room_config_snapshot.interruptions.mode,
            roundOf(keptRound).rules_snapshot.interaction.interruptions.allowed,
          ],
        },
        expected: {
          retiredRoom: ['disabled', 'disabled'],
          keptRoom: ['enabled', 'enabled'],
          retiredRound: ['disabled', 'disabled'],
          keptRound: ['open', 'open'],
        },
      });
    });
  },
  ddlTimeoutMs,
);
