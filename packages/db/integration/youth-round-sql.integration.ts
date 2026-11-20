import { requireTestServices } from '@daisy/config';
import { isYouthRound, type RatingDivision } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, test } from 'riteway/bun';
import {
  mediaReleaseWording,
  reuseFenced,
} from '@daisy/protocol/media-release';
import { youthReuseFencedSql, youthRoundSql } from '../src/youth-round-sql';
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

/**
 * ADR 0161: `youthReuseFencedSql` is the SQL mirror of `reuseFenced`. A Youth
 * Round and an Open Round, each with no debater, two unreleased, one released,
 * both released, one withdrawn and one holding paid ads alone, give the same
 * answer in SQL as in the rule; a release outside its seats never counts.
 */
test('youthReuseFencedSql agrees with reuseFenced on every release standing', async () => {
  await withFixture(databaseUrl, async (f) => {
    const caller = await createAuthorizationSubject(f);
    const formatId = await f.format();
    const standings = [
      'no debater',
      'none released',
      'one released',
      'both released',
      'one withdrawn',
      'paid ads only',
      'old wording',
    ] as const;
    type Standing = (typeof standings)[number];
    const release = (
      userId: string,
      scope: 'publish' | 'paid_ads',
      withdrawn = false,
      wordingVersion: string = mediaReleaseWording.version,
    ) =>
      f.sql`insert into media_releases (id,user_id,scope,source,signer_name,signer_relation,signer_email,wording_version,signed_at,withdrawn_at,withdrawn_by)
        values (${createId()},${userId},${scope},'parent','A Parent','parent','parent@example.test',${wordingVersion},now() - interval '1 day',${withdrawn ? new Date() : null},${withdrawn ? 'parent' : null})`;
    const facts: {
      readonly label: string;
      readonly roundId: string;
      readonly youth: boolean;
      readonly debaterUserIds: readonly string[];
      readonly releases: {
        readonly subjectUserId: string;
        readonly scope: 'publish' | 'paid_ads';
        readonly withdrawnAt: string | null;
        readonly wordingVersion: string;
      }[];
    }[] = [];
    for (const division of ['open', 'youth'] as const)
      for (const standing of standings as readonly Standing[]) {
        const roomId = await f.room(caller.actorId, formatId, { division });
        const debaterUserIds: string[] =
          standing === 'no debater' ? [] : [await f.user(), await f.user()];
        const cast = [];
        for (const [index, userId] of debaterUserIds.entries())
          cast.push({
            seat: index === 0 ? 'affirmative' : 'negative',
            actorId: await f.actor(userId),
          });
        const { id: roundId } = await f.roundWithCast(
          {
            room_id: roomId,
            room_config_snapshot: validConfig,
            visibility: 'public',
            format_id: formatId,
            competition_type: 'casual',
            ladder_id: null,
            ladder_division: null,
          },
          cast,
        );
        const releases: (typeof facts)[number]['releases'] = [];
        // Someone outside its debating seats holds a release: it never counts.
        await release(await f.user(), 'publish');
        const [first, second] = debaterUserIds;
        const grant = async (
          userId: string,
          scope: 'publish' | 'paid_ads',
          withdrawn = false,
          wordingVersion: string = mediaReleaseWording.version,
        ) => {
          await release(userId, scope, withdrawn, wordingVersion);
          releases.push({
            subjectUserId: userId,
            scope,
            wordingVersion,
            withdrawnAt: withdrawn ? new Date().toISOString() : null,
          });
        };
        if (standing === 'one released') await grant(first!, 'publish');
        if (standing === 'both released') {
          await grant(first!, 'publish');
          await grant(second!, 'publish');
        }
        if (standing === 'one withdrawn') {
          await grant(first!, 'publish');
          await grant(second!, 'publish', true);
        }
        if (standing === 'paid ads only') {
          await grant(first!, 'paid_ads');
          await grant(second!, 'paid_ads');
        }
        if (standing === 'old wording') {
          await grant(first!, 'publish');
          await grant(second!, 'publish', false, '2026-11-v1');
        }
        facts.push({
          label: `${division} × ${standing}`,
          roundId,
          youth: division === 'youth',
          debaterUserIds,
          releases,
        });
      }
    const db = drizzle({ client: f.sql });
    const actual: Record<string, boolean> = {};
    const expected: Record<string, boolean> = {};
    for (const fact of facts) {
      const [row] = (await db.execute(
        sql`select ${youthReuseFencedSql(sql`${fact.roundId}`)} as fenced`,
      )) as unknown as { fenced: boolean }[];
      actual[fact.label] = row!.fenced;
      expected[fact.label] = reuseFenced(fact);
    }
    assert({
      given:
        'an Open and a Youth Round for every release standing of their debaters',
      should: 'answer in SQL exactly as the rule does',
      actual,
      expected,
    });
    assert({
      given: 'the same table',
      should:
        'fence only Youth Rounds, and lift the fence only when every youth debater holds an active release',
      actual: Object.entries(expected)
        .filter(([, fenced]) => fenced)
        .map(([key]) => key),
      expected: [
        'youth × no debater',
        'youth × none released',
        'youth × one released',
        'youth × one withdrawn',
        'youth × paid ads only',
        'youth × old wording',
      ],
    });
  });
});
