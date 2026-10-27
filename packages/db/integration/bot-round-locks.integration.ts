import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withBotPublication } from './bot-publication.test-support';
import {
  admissionSponsor,
  testBotAdmission,
} from './bot-admission.test-support';
import { lockRoundAgentContext } from '../src/round-agent-runs';
setupRitewayBun();
requireTestServices(process.env);

for (const writer of ['agent', 'admission'] as const) {
  test(`${writer} Round fence permits an earlier pending attendance receipt`, async () => {
    await withBotPublication(async ({ fixture, run, target }) => {
      const actorId = await admissionSponsor(fixture, [target.roundId]);
      const admission = testBotAdmission(run);
      const held = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const transaction = run(async (tx) => {
        if (writer === 'agent')
          await lockRoundAgentContext(
            tx,
            target.roundId,
            target.roundParticipantId,
          );
        else {
          await admission.lock(tx);
          await admission.reserveLocked(tx, {
            roundId: target.roundId,
            actorId,
          });
        }
        held.resolve();
        await release.promise;
      });
      void transaction.catch(held.reject);
      try {
        await held.promise;
        const attempt = createId();
        await fixture.sql.begin(async (tx) => {
          await tx`set local lock_timeout='100ms'`;
          await tx`insert into round_check_in_attempts(attempt_id,command_id,round_id,payload_digest,actor_id,backend_pid,backend_started_at)
            select ${attempt},${createId()},${target.roundId},${'d'.repeat(64)},${actorId},pg_backend_pid(),backend_start
            from pg_stat_activity where pid=pg_backend_pid()`;
        });
        assert({
          given: 'the actual E1 writer already owns its Round fence',
          should:
            'commit first PG receipt evidence before releasing that writer',
          actual: await fixture.count(
            'round_check_in_attempts',
            'attempt_id',
            attempt,
          ),
          expected: 1,
        });
      } finally {
        release.resolve();
        await transaction;
      }
    });
  });
}
