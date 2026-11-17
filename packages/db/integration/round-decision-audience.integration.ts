import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundDecisionAudience } from '../src/round-decision-release';
import { withFixture, type Fixture } from './constraint-helpers';
import { judgedRound } from './judged-round.test-support';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { oneOnOneDefinition, oneOnOneSettings } from '../src/reference-formats';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const userOf = async (f: Fixture, actorId: string) =>
  (
    (await f.sql`select user_id from actors where id=${actorId}`) as {
      user_id: string;
    }[]
  )[0]!.user_id;

/**
 * Replaces the Round's judge in slot 0 the way Tab's change_judge commits it
 * (a new judge identity, the assignment's next version), leaving the first
 * judge's row as retired history.
 */
const replaceJudge = (f: Fixture, roundId: string, byActorId: string) =>
  f.sql.begin(async (tx) => {
    const replacementActorId = await f.actor();
    const replacementId = createId();
    const commandId = createId();
    await tx`insert into round_participants(id,round_id,actor_id,seat_kind,side,slot) values(${replacementId},${roundId},${replacementActorId},'judge',null,0)`;
    const result = {
      kind: 'judge_assignment',
      roundId,
      slot: 0,
      assignmentVersion: 2,
      participantId: replacementId,
    };
    const digest = new Bun.CryptoHasher('sha3-256')
      .update(JSON.stringify(result))
      .digest('hex');
    await tx`insert into round_commands(command_id,round_id,actor_id,service_id,type,payload_digest,result,resulting_version,applied_at) values(${commandId},${roundId},${byActorId},null,'change_judge',${digest},${result},2,date_trunc('milliseconds',clock_timestamp()))`;
    await tx`select public.daisy_append_round_judge_assignment(${roundId},0,1,1,${replacementId},${commandId})`;
    return replacementActorId;
  });

test('a judge replaced before the decision is not told it; the replacement is (ADR 0144, TAB-6)', async () => {
  await withFixture(databaseUrl, async (f) => {
    const roundId = await judgedRound(f);
    const affirmative = await f.seat(roundId, 'affirmative');
    const negative = await f.seat(roundId, 'negative');
    const retired = await f.seat(roundId, 'judge');
    const replacement = await replaceJudge(f, roundId, affirmative.actorId);
    const audience = await roundDecisionAudience(
      drizzle({ client: f.sql }),
      roundId,
    );
    const byUser = new Map(audience.map((row) => [row.userId, row.about]));
    assert({
      given:
        'a judged Round whose first judge was replaced before its decision',
      should:
        'tell both debaters, each about the other side, and the replacement judge about the first side, but not the replaced judge',
      actual: {
        affirmative: byUser.get(await userOf(f, affirmative.actorId)),
        negative: byUser.get(await userOf(f, negative.actorId)),
        replacement: byUser.get(await userOf(f, replacement)),
        retired: byUser.has(await userOf(f, retired.actorId)),
        size: audience.length,
      },
      expected: {
        affirmative: negative.actorId,
        negative: affirmative.actorId,
        replacement: affirmative.actorId,
        retired: false,
        size: 3,
      },
    });
  });
});

test('a judge is told about the first declared side, not the first by name (TAB-6)', async () => {
  await withFixture(databaseUrl, async (f) => {
    const compiled = resolveRoomConfiguration(
      oneOnOneDefinition,
      oneOnOneSettings,
    );
    if (!compiled.ok) throw new Error('The judged revision did not compile');
    // Negative declared first: alphabetical order would name Affirmative.
    const rules = {
      ...compiled.rules,
      sides: [...compiled.rules.sides].reverse(),
    };
    const roundId = await f.round(
      { format_id: 'one-on-one', format_version: 2 },
      { rules },
    );
    await f.seat(roundId, 'affirmative');
    const negative = await f.seat(roundId, 'negative');
    const judge = await f.seat(roundId, 'judge');
    const audience = await roundDecisionAudience(
      drizzle({ client: f.sql }),
      roundId,
    );
    assert({
      given: 'a judged Round whose rules declare Negative before Affirmative',
      should: 'tell the judge about the first declared side’s first seat',
      actual: new Map(audience.map((row) => [row.userId, row.about])).get(
        await userOf(f, judge.actorId),
      ),
      expected: negative.actorId,
    });
  });
});
