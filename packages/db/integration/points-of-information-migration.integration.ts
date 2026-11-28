import { SQL } from 'bun';
import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { Fixture } from './constraint-helpers';
import {
  foundationDefinition,
  validConfig,
  validRules,
} from './round-fixtures';
import { daisyOrganizationId } from '../src/daisy-reference';

import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';

const migration = '20261127171201_points_of_information';
const { databaseUrl } = integrationSuite();
const scratch = scratchDatabase(databaseUrl, 'pointsofinformation');
afterAll(() => scratch.drop());

const defaults = {
  protectedStartMs: 60_000,
  protectedEndMs: 60_000,
  maxDurationMs: 15_000,
  offerLapseMs: 10_000,
};
const bounds = {
  protectedStartMs: { min: 0, max: 120_000 },
  protectedEndMs: { min: 0, max: 120_000 },
  maxDurationMs: { min: 5_000, max: 30_000 },
  offerLapseMs: { min: 5_000, max: 30_000 },
};

/** The stored shapes before the migration: interruptions, and a version-1 checkpoint. */
const withoutPoints = <T extends Record<string, unknown>>(value: T) => {
  const { pointsOfInformation: _, ...rest } = value;
  return rest;
};
const oldDefinition = (interruptions: unknown) => ({
  ...foundationDefinition,
  configurable: {
    ...foundationDefinition.configurable,
    interaction: {
      ...withoutPoints(foundationDefinition.configurable.interaction),
      interruptions,
    },
  },
});
const oldConfig = (interruptions: unknown) => ({
  ...withoutPoints(validConfig),
  interruptions,
});
const oldRules = (allowed: string) => ({
  ...validRules,
  interaction: {
    ...withoutPoints(validRules.interaction),
    interruptions:
      allowed === 'enabled' ? { allowed, minRemainingMs: 30_000 } : { allowed },
  },
});
const oldCheckpoint = (prep: {
  readonly active_prep: unknown;
  readonly prep_ended_at: string | null;
}) => ({
  version: 1,
  prep_consumed_ms: { affirmative: 12_000, negative: 0 },
  ...prep,
  floor: { holder_participant_id: createId(), started_at: '2026-11-27T10:00:00.000Z' },
  incident: { phase: 'none' },
  start_gate: null,
  clock_stops: [],
});

test(
  `${migration}: every stored interruption becomes a point-of-information choice and every checkpoint its one prep state`,
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    const sql = new SQL(scratch.url, { max: 1 });
    const fixture = new Fixture(sql);
    try {
      const offering = await fixture.format(
        oldDefinition({ modes: ['disabled', 'enabled'], minRemainingMs: { min: 0, max: 60_000 } }) as never,
      );
      const forbidding = await fixture.format(oldDefinition(null) as never);
      const presets = { enabled: offering, disabled: forbidding } as const;
      for (const [mode, formatId] of Object.entries(presets))
        await sql.unsafe(
          `insert into format_presets (format_id, version, format_version, config, approved_at)
           values ($1, 1, 1, $2::jsonb, statement_timestamp())`,
          [formatId, oldConfig({ mode, minRemainingMs: 0 })],
        );
      const host = await fixture.actor();
      const room = await fixture.room(host, offering, {
        config: oldConfig({ mode: 'open', minRemainingMs: 0 }),
        rules_snapshot: oldRules('open'),
      });
      const prepping = await fixture.round({
        format_id: forbidding,
        room_config_snapshot: oldConfig(null),
        rules_snapshot: oldRules('disabled'),
        runtime_state: oldCheckpoint({
          active_prep: { side: 'affirmative', started_at: '2026-11-27T10:00:00.000Z' },
          prep_ended_at: null,
        }),
      });
      const leading = await fixture.round({
        format_id: offering,
        room_config_snapshot: oldConfig({ mode: 'enabled', minRemainingMs: 30_000 }),
        rules_snapshot: oldRules('enabled'),
        runtime_state: oldCheckpoint({
          active_prep: null,
          prep_ended_at: '2026-11-27T10:01:00.000Z',
        }),
      });
      const idle = await fixture.round({
        format_id: offering,
        runtime_state: oldCheckpoint({ active_prep: null, prep_ended_at: null }),
      });
      const setting = createId();
      await fixture.insert('settings', {
        id: setting,
        scope_kind: 'organization',
        organization_id: daisyOrganizationId,
        key: 'room.floor',
        hold: 'default',
        value: {
          interruptions: { mode: 'enabled', minRemainingMs: 0 },
          yielding: { allowed: true, returnsTime: true },
        },
      });

      await scratch.migrate(() => true);

      const definitions = await sql`select format_id, definition #> '{configurable,interaction}' as interaction from format_revisions where format_id in ${sql([offering, forbidding])}`;
      const presetRows = await sql`select format_id, config -> 'pointsOfInformation' as poi, config ? 'interruptions' as stale from format_presets where format_id in ${sql([offering, forbidding])}`;
      const [roomRow] = await sql`select config -> 'pointsOfInformation' as config, rules_snapshot #> '{interaction,pointsOfInformation}' as rules from rooms where id = ${room}`;
      const rounds = await sql`select id, room_config_snapshot -> 'pointsOfInformation' as config, rules_snapshot #> '{interaction,pointsOfInformation}' as rules, runtime_state from rounds where id in ${sql([prepping, leading, idle])}`;
      const [settingRow] = await sql`select value from settings where id = ${setting}`;
      const byFormat = (rows: readonly Record<string, unknown>[], id: string) =>
        rows.find((row) => row.format_id === id);
      const byRound = (id: string) =>
        rounds.find((row: { id: string }) => row.id === id);
      const checkpoint = (id: string) => {
        const state = byRound(id).runtime_state;
        return {
          version: state.version,
          prep: state.prep,
          point: state.point_of_information,
          stale: ['active_prep', 'prep_ended_at', 'floor'].filter(
            (key) => key in state,
          ),
          consumed: state.prep_consumed_ms,
        };
      };
      assert({
        given:
          'format definitions offering and forbidding interruptions, their presets, an open Room, two Rounds and a league floor setting',
        should:
          'offer points of information within Daisy’s bounds where any interruption was offered, take them at the parliamentary defaults where the floor was taken or opened, and decline them where interruptions were declined',
        actual: {
          offering: byFormat(definitions, offering)?.interaction,
          forbidding: byFormat(definitions, forbidding)?.interaction,
          presets: [
            byFormat(presetRows, offering)?.poi,
            byFormat(presetRows, forbidding)?.poi,
            presetRows.some((row: { stale: boolean }) => row.stale),
          ],
          room: roomRow,
          prepping: [byRound(prepping).config, byRound(prepping).rules],
          leading: [byRound(leading).config, byRound(leading).rules],
          setting: settingRow.value,
        },
        expected: {
          offering: {
            ...withoutPoints(foundationDefinition.configurable.interaction),
            pointsOfInformation: bounds,
          },
          forbidding: {
            ...withoutPoints(foundationDefinition.configurable.interaction),
            pointsOfInformation: null,
          },
          presets: [{ enabled: true, ...defaults }, { enabled: false }, false],
          room: {
            config: { enabled: true, ...defaults },
            rules: { allowed: true, ...defaults },
          },
          prepping: [null, { allowed: false }],
          leading: [{ enabled: true, ...defaults }, { allowed: true, ...defaults }],
          setting: {
            pointsOfInformation: { enabled: true, ...defaults },
            yielding: { allowed: true, returnsTime: true },
          },
        },
      });
      assert({
        given:
          'checkpoints running prep, in the microphone lead after prep, and idle, each holding an interruption floor',
        should:
          'keep each prep as its one state and its spend, return every floor to the speaker, and stamp version 2',
        actual: [checkpoint(prepping), checkpoint(leading), checkpoint(idle)],
        expected: [
          {
            version: 2,
            prep: {
              phase: 'running',
              side: 'affirmative',
              started_at: '2026-11-27T10:00:00.000Z',
            },
            point: { phase: 'none' },
            stale: [],
            consumed: { affirmative: 12_000, negative: 0 },
          },
          {
            version: 2,
            prep: { phase: 'lead', ended_at: '2026-11-27T10:01:00.000Z' },
            point: { phase: 'none' },
            stale: [],
            consumed: { affirmative: 12_000, negative: 0 },
          },
          {
            version: 2,
            prep: { phase: 'idle' },
            point: { phase: 'none' },
            stale: [],
            consumed: { affirmative: 12_000, negative: 0 },
          },
        ],
      });
    } finally {
      await sql.close();
    }
  },
  ddlTimeoutMs,
);
