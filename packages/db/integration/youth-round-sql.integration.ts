import { requireTestServices } from '@daisy/config';
import { isYouthRound, type RatingDivision } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, test } from 'riteway/bun';
import { youthRoundSql } from '../src/youth-round-sql';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture } from './constraint-helpers';
import { validConfig } from './round-fixtures';
import { integrationSuite } from './suite.test-support';

requireTestServices(process.env);
const { databaseUrl } = integrationSuite();

/**
 * ADR 0157: `youthRoundSql` is the SQL mirror of `isYouthRound`. Every Room
 * division (and no Room) against every ladder (none, Open, Youth) gives the
 * same answer in SQL as in the rule.
 */
test('youthRoundSql agrees with isYouthRound on every Room and ladder', async () => {
  await withFixture(databaseUrl, async (f) => {
    const caller = await createAuthorizationSubject(f);
    const formatId = await f.format();
    // A ranked Round rates on a ladder, which needs the Freestyle preset.
    const [preset] =
      await f.sql`select format_version, version from format_presets where format_id='freestyle' and superseded_at is null`;
    const ranked = {
      format_id: 'freestyle',
      format_version: preset!.format_version,
      preset_version: preset!.version,
    };
    const rooms = [null, 'open', 'youth'] as const;
    const ladders = [null, 'open', 'youth'] as const;
    const cases: {
      readonly room: RatingDivision | null;
      readonly ladder: RatingDivision | null;
      readonly roundId: string;
    }[] = [];
    for (const room of rooms)
      for (const ladder of ladders) {
        const roomId =
          room === null
            ? null
            : await f.room(caller.actorId, formatId, {
                division: room,
                competition_type: ladder === null ? 'casual' : 'ranked',
                ...(ladder === null ? {} : ranked),
              });
        const roundId = await f.round({
          room_id: roomId,
          // A Room's Round freezes what the Room set (rounds_room_freeze_complete).
          ...(roomId === null
            ? {}
            : { room_config_snapshot: validConfig, visibility: 'public' }),
          ...(ladder === null ? { format_id: formatId } : ranked),
          competition_type: ladder === null ? 'casual' : 'ranked',
          ladder_id: ladder === null ? null : 'freestyle',
          ladder_division: ladder,
        });
        cases.push({ room, ladder, roundId });
      }
    const db = drizzle({ client: f.sql });
    const inSql = async (roundId: string) => {
      const [row] = (await db.execute(
        sql`select ${youthRoundSql(sql`${roundId}`)} as youth`,
      )) as unknown as { youth: boolean }[];
      return row!.youth;
    };
    const label = (room: string | null, ladder: string | null) =>
      `${room ?? 'no Room'} × ${ladder ?? 'no ladder'}`;
    const actual: Record<string, boolean> = {};
    const expected: Record<string, boolean> = {};
    for (const { room, ladder, roundId } of cases) {
      actual[label(room, ladder)] = await inSql(roundId);
      expected[label(room, ladder)] = isYouthRound(
        { ladderDivision: ladder },
        room === null ? null : { division: room },
      );
    }
    assert({
      given: 'a Round for every Room division and ladder, and none',
      should: 'answer in SQL exactly as the rule does',
      actual,
      expected,
    });
    assert({
      given: 'the same table',
      should:
        'be Youth whenever its Room or its ladder is, and only then (fail closed)',
      actual: Object.entries(expected)
        .filter(([, youth]) => youth)
        .map(([key]) => key),
      expected: [
        'no Room × youth',
        'open × youth',
        'youth × no ladder',
        'youth × open',
        'youth × youth',
      ],
    });
  });
});
