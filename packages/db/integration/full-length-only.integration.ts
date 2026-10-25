import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture } from './constraint-helpers';
import { validConfig, validRules } from './round-fixtures';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { change, rating, season } from './standings-fixtures';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261025223110_full_length_only';
const scratch = scratchDatabase(url, 'fulllengthit');
const started = new Date('2026-10-20T10:00:00.000Z');
const ended = new Date('2026-10-20T11:00:00.000Z');

afterAll(() => scratch.drop());

test(
  'the migration closes and converts every quick Room and Round, deletes the Quick ladder and keeps full ones as they were (DEC-237, DEC-240)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    await withFixture(scratch.url, async (f) => {
      const host = await f.actor();
      const [aff, neg] = [await f.actor(), await f.actor()];
      const room = async (row: Record<string, unknown>) => {
        const id = createId();
        await f.insert('rooms', {
          id,
          host_actor_id: host,
          title: 'Title',
          topic: 'Topic',
          visibility: 'public',
          format_id: 'one-on-one',
          format_version: 2,
          preset_version: null,
          competition_type: 'casual',
          config: validConfig,
          execution_plan: {},
          rules_snapshot: validRules,
          status: 'assembling',
          ...row,
        });
        return id;
      };
      const round = (row: Record<string, unknown>) =>
        f.round({
          format_id: 'one-on-one',
          format_version: 2,
          started_at: started,
          ...row,
        });
      const ranked = (length: 'full' | 'quick') => ({
        competition_type: 'ranked',
        length,
        preset_version: 2,
        ladder_id: length === 'full' ? 'ranked' : 'quick',
      });
      const casualQuickRoom = await room({ length: 'quick' });
      const rankedQuickRoom = await room({
        length: 'quick',
        competition_type: 'ranked',
        preset_version: 2,
        status: 'ready',
      });
      const rankedFullRoom = await room({
        length: 'full',
        competition_type: 'ranked',
        preset_version: 2,
      });
      const casualQuickRound = await round({
        length: 'quick',
        status: 'completed',
        outcome: 'affirmative',
        completed_at: ended,
      });
      const liveQuickRound = await round({
        ...ranked('quick'),
        status: 'active',
        current_stage: 'live',
      });
      const ratedQuickRound = await round({
        ...ranked('quick'),
        status: 'completed',
        outcome: 'negative',
        completed_at: ended,
      });
      const ratedFullRound = await round({
        ...ranked('full'),
        status: 'completed',
        outcome: 'affirmative',
        completed_at: ended,
      });
      const seasonId = await season(f, 'closed', started);
      for (const [roundId, ladder] of [
        [ratedQuickRound, 'quick'],
        [ratedFullRound, 'ranked'],
      ] as const)
        for (const actorId of [aff, neg]) {
          await f.participant(
            roundId,
            actorId === aff ? 'affirmative' : 'negative',
            0,
            actorId,
          );
          await change(f, {
            roundId,
            actorId,
            formatId: 'one-on-one',
            seasonId,
            ladder,
            before: 1500,
            after: 1510,
            occurredAt: ended,
          });
          await rating(f, {
            actorId,
            formatId: 'one-on-one',
            seasonId,
            ladder,
            rating: 1510,
          });
        }

      await scratch.migrate((folder) => folder <= migration);

      const rooms = await f.sql`
        select id, status, competition_type, preset_version,
               rules_snapshot = ${validRules}::jsonb as rules_kept
          from rooms
         where id in ${f.sql([casualQuickRoom, rankedQuickRoom, rankedFullRoom])}`;
      const rounds = await f.sql`
        select id, status, competition_type, preset_version, ladder_id,
               outcome, completed_at is not null as ended,
               rules_snapshot = ${validRules}::jsonb as rules_kept
          from rounds
         where id in ${f.sql([casualQuickRound, liveQuickRound, ratedQuickRound, ratedFullRound])}`;
      const ladders = await f.sql`
        select 'change' as kind, ladder from rating_changes where season_id = ${seasonId}
        union all
        select 'rating', ladder from ratings where season_id = ${seasonId}
        order by 1, 2`;
      const presets = await f.sql`
        select version, format_version, superseded_at is null as current
          from format_presets
         where format_id = 'one-on-one'
         order by version`;
      const byId = <T extends { id: string }>(rows: readonly T[], id: string) =>
        rows.find((row) => row.id === id);
      assert({
        given:
          'casual and ranked quick Rooms, a ranked full Room, a completed casual quick Round, a live and a rated ranked quick Round, and a rated ranked full Round',
        should:
          'close the open quick Rooms and Round, make every quick one casual with no preset or ladder, delete the Quick ladder, keep every rules snapshot, and leave the full ones and one preset per revision',
        actual: {
          casualQuickRoom: byId([...rooms], casualQuickRoom),
          rankedQuickRoom: byId([...rooms], rankedQuickRoom),
          rankedFullRoom: byId([...rooms], rankedFullRoom),
          casualQuickRound: byId([...rounds], casualQuickRound),
          liveQuickRound: byId([...rounds], liveQuickRound),
          ratedQuickRound: byId([...rounds], ratedQuickRound),
          ratedFullRound: byId([...rounds], ratedFullRound),
          ladders: [...ladders],
          presets: [...presets],
        },
        expected: {
          casualQuickRoom: {
            id: casualQuickRoom,
            status: 'abandoned',
            competition_type: 'casual',
            preset_version: null,
            rules_kept: true,
          },
          rankedQuickRoom: {
            id: rankedQuickRoom,
            status: 'abandoned',
            competition_type: 'casual',
            preset_version: null,
            rules_kept: true,
          },
          rankedFullRoom: {
            id: rankedFullRoom,
            status: 'assembling',
            competition_type: 'ranked',
            preset_version: 2,
            rules_kept: true,
          },
          casualQuickRound: {
            id: casualQuickRound,
            status: 'completed',
            competition_type: 'casual',
            preset_version: null,
            ladder_id: null,
            outcome: 'affirmative',
            ended: true,
            rules_kept: true,
          },
          liveQuickRound: {
            id: liveQuickRound,
            status: 'abandoned',
            competition_type: 'casual',
            preset_version: null,
            ladder_id: null,
            outcome: null,
            ended: true,
            rules_kept: true,
          },
          ratedQuickRound: {
            id: ratedQuickRound,
            status: 'completed',
            competition_type: 'casual',
            preset_version: null,
            ladder_id: null,
            outcome: 'negative',
            ended: true,
            rules_kept: true,
          },
          ratedFullRound: {
            id: ratedFullRound,
            status: 'completed',
            competition_type: 'ranked',
            preset_version: 2,
            ladder_id: 'ranked',
            outcome: 'affirmative',
            ended: true,
            rules_kept: true,
          },
          ladders: [
            { kind: 'change', ladder: 'ranked' },
            { kind: 'change', ladder: 'ranked' },
            { kind: 'rating', ladder: 'ranked' },
            { kind: 'rating', ladder: 'ranked' },
          ],
          presets: [
            { version: 1, format_version: 1, current: false },
            { version: 2, format_version: 2, current: true },
          ],
        },
      });
    });
  },
  ddlTimeoutMs,
);
