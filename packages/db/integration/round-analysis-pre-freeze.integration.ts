import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { erasePrivacySubject } from '../src/privacy';
import { roundAnalysisPrivacyAdopter } from '../src/round-analysis-privacy';
import { withCompletedRound } from './round-analysis.test-support';
import { bindings } from './privacy.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('canonical erasure during an active Round prevents any round analysis after its later freeze', async () => {
  let erasedWhileActive = false;
  await withCompletedRound(
    async ({ fixture, roundId, aff, neg, seats, jobs, facts }) => {
      const state = await facts(aff);
      const [before] =
        await fixture.sql`select count(*)::int as n from round_analyses where round_id=${roundId}`;
      let decisions = 0;
      const claimed = await jobs.claim(seats.neg, () => {
        decisions++;
        return 'claim';
      });
      const [after] =
        await fixture.sql`select count(*)::int as n from round_analyses where round_id=${roundId}`;
      assert({
        given:
          'a seated debater canonically erased before the active Round completed and froze',
        should:
          'never list or claim a later analysis, even for the other debater who has remaining text',
        actual: {
          erasedWhileActive,
          status: state.status,
          frozen: state.frozen,
          lines: state.lines,
          listed: (await jobs.scan(64, new Date(0).toISOString(), () => true))
            .map((seat) => seat.roundParticipantId)
            .some((id) => [aff.id, neg.id].includes(id)),
          claimed,
          decisions,
          attempts: [before.n, after.n],
        },
        expected: {
          erasedWhileActive: true,
          status: 'completed',
          frozen: true,
          lines: 1,
          listed: false,
          claimed: null,
          decisions: 0,
          attempts: [0, 0],
        },
      });
    },
    {
      beforeFreeze: async (fixture, client, aff) => {
        const [actor] =
          await client`select user_id from actors where id=${aff.actorId}`;
        const [state] = await fixture.sql`select r.status,
          exists(select 1 from round_transcript_freezes f where f.round_id=r.id) as frozen
          from rounds r join round_participants p on p.round_id=r.id where p.id=${aff.id}`;
        const adopter = roundAnalysisPrivacyAdopter;
        const expectedColumns = Object.fromEntries(
          [...new Set(adopter.fields.map((field) => field.table))].map(
            (table) => [
              table,
              adopter.fields
                .filter((field) => field.table === table)
                .map((field) => field.column),
            ],
          ),
        );
        await erasePrivacySubject(
          drizzle({ client }),
          {
            subject: { userId: actor.user_id, actorId: aff.actorId },
            now: new Date().toISOString(),
            vendors: [],
            jobIds: [],
          },
          {
            requiredAdopters: [
              { id: adopter.id, phase: adopter.phase, expectedColumns },
            ],
            adopters: [adopter],
          },
          bindings,
        );
        erasedWhileActive = state.status === 'active' && !state.frozen;
      },
    },
  );
});
