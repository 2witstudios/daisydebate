import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { roundAnalysisPrivacyAdopter } from '../src/round-analysis-privacy';
import {
  claim,
  dayAgo,
  listedSeats,
  withCompletedRound,
} from './round-analysis.test-support';
setupRitewayBun();
requireTestServices(process.env);

/** Erases one seated debater through the round analysis privacy adopter. */
async function eraseDebater(client: SQL, actorId: string) {
  const [user] =
    (await client`select user_id from actors where id=${actorId}`) as {
      user_id: string;
    }[];
  await drizzle({ client }).transaction((tx) =>
    roundAnalysisPrivacyAdopter.erase(
      tx,
      { userId: user!.user_id, actorId },
      { now: new Date().toISOString() },
    ),
  );
}
const erased = {
  status: 'failed',
  attempts: 1,
  leaseExpiresAt: null,
  report: null,
} as const;

test('erasing a debater clears every analysis of their Round for good', async () =>
  withCompletedRound(
    async ({ client, roundId, aff, neg, seats, jobs, facts }) => {
      const first = await jobs.claim(seats.neg, claim);
      if (!first) throw Error('Expected a claim');
      await jobs.complete(seats.neg, first.token, report);
      const exportOf = async (actorId: string) => {
        const [user] =
          (await client`select user_id from actors where id=${actorId}`) as {
            user_id: string;
          }[];
        return drizzle({ client }).transaction((tx) =>
          roundAnalysisPrivacyAdopter.export(tx, {
            userId: user!.user_id,
            actorId,
          }),
        );
      };
      assert({
        given: 'the analysed debater and their opponent exporting their data',
        should: 'give each only the reports of their own seats',
        actual: {
          neg: (
            (await exportOf(neg.actorId)).round_analyses as {
              round_id: string;
              report: unknown;
            }[]
          ).map(({ round_id, report: exported }) => [round_id, exported]),
          aff: (await exportOf(aff.actorId)).round_analyses,
        },
        expected: { neg: [[roundId, report]], aff: [] },
      });
      await eraseDebater(client, aff.actorId);
      assert({
        given:
          'an analysed opponent seat whose Round’s other debater is erased within the window',
        should:
          'drop every report (each quotes both sides) and leave both seats failed, never listed or bought again',
        actual: {
          aff: (await facts(aff)).analysis,
          neg: (await facts(neg)).analysis,
          listed: (await listedSeats(jobs, dayAgo())).filter((id) =>
            [aff.id, neg.id].includes(id),
          ),
          retaken: await jobs.claim(seats.neg, claim),
        },
        expected: { aff: erased, neg: erased, listed: [], retaken: null },
      });
    },
  ));

test('erasing a debater during an analysis refuses its report', async () =>
  withCompletedRound(async ({ client, aff, seats, jobs, facts }) => {
    const held = await jobs.claim(seats.aff, claim);
    if (!held) throw Error('Expected a claim');
    await eraseDebater(client, aff.actorId);
    await assertRejects({
      given: 'an analysis call still running when its debater is erased',
      should: 'refuse its report with CONFLICT',
      actual: () => jobs.complete(seats.aff, held.token, report),
      code: 'CONFLICT',
    });
    assert({
      given: 'the erased seat',
      should: 'stay failed with no report',
      actual: (await facts(aff)).analysis,
      expected: erased,
    });
  }));
