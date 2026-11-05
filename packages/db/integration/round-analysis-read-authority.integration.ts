import { createId } from '@paralleldrive/cuid2';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src/index';
import { finishedOrBlockedBehind } from '../src/testing';
import { runPrivacyErasure } from '../src/privacy/operations';
import { roundAnalysisPrivacyAdopter } from '../src/round-analysis-privacy';
import { roundTranscriptPrivacyAdopter } from '../src/round-transcript-privacy';
import { claim, withCompletedRound } from './round-analysis.test-support';
import { bindings } from './privacy.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('stored report reads survive lapse and serialize with every frozen participant erasure', async () => {
  await withCompletedRound(
    async ({ fixture, client, roundId, aff, neg, seats, jobs }) => {
      const leased = await jobs.claim(seats.aff, claim);
      if (!leased) throw Error('Expected seeded report lease');
      await jobs.complete(seats.aff, leased.token, report);
      const store = createDatabase({
        url: databaseUrl,
        client: fixture.sql,
        nextActorId: createId,
      });
      const [owner] =
        await client`select user_id from actors where id=${aff.actorId}`;
      const [opponent] =
        await client`select user_id from actors where id=${neg.actorId}`;
      const caller = { userId: String(owner!.user_id), actorId: aff.actorId };
      await client`update users set email_verified=true where id in (${owner!.user_id},${opponent!.user_id})`;
      await client`delete from account_entitlement_grants where user_id=${caller.userId}`;
      let decisions = 0;
      const read = () =>
        store.readRoundAnalysis({
          roundId,
          caller,
          authorize: (access) => {
            decisions++;
            return authorize({
              principal: { kind: 'user', ...caller },
              capability: 'round.analysis.read',
              resource: access.round,
              context: {
                account: access.account,
                entitlements: { roundAnalysis: false },
              },
            }).allow;
          },
        });
      assert({
        given: 'a delivered own report after every grant is removed',
        should:
          'return the same report under current account and seat authority',
        actual: (await read()).facts.analysis?.report,
        expected: report,
      });
      await assertRejects({
        given:
          'a caller trying to pair another user with the stored report owner actor',
        should: 'refuse the private read',
        code: 'NOT_FOUND',
        actual: () =>
          store.readRoundAnalysis({
            roundId,
            caller: { ...caller, userId: String(opponent!.user_id) },
            authorize: () => true,
          }),
      });
      await assertRejects({
        given: 'the owning seat but a refused current read policy',
        should: 'refuse before returning any stored report',
        code: 'NOT_FOUND',
        actual: () =>
          store.readRoundAnalysis({ roundId, caller, authorize: () => false }),
      });
      const entered = Promise.withResolvers<number>();
      const finish = Promise.withResolvers<void>();
      void entered.promise.catch(() => undefined);
      const timeout = setTimeout(() => {
        entered.reject(Error('Erasure did not reach the held checkpoint'));
        finish.resolve();
      }, 3000);
      const closing = runPrivacyErasure(
        drizzle({ client }),
        {
          subject: { userId: String(opponent!.user_id), actorId: neg.actorId },
          now: new Date().toISOString(),
          vendors: [],
          jobIds: [],
        },
        [
          roundTranscriptPrivacyAdopter,
          roundAnalysisPrivacyAdopter,
          {
            id: 'held-erasure-test',
            phase: 'after-close',
            erase: async (tx) => {
              const [backend] = await tx.execute(
                sql`select pg_backend_pid() as pid`,
              );
              entered.resolve(Number(backend!.pid));
              await finish.promise;
            },
            export: async () => ({}),
          },
        ],
        bindings,
      ).catch((error) => {
        entered.reject(error);
        finish.resolve();
        throw error;
      });
      const closingObserved = Promise.allSettled([closing]);
      let reading: ReturnType<typeof read> | undefined;
      let readObserved: Promise<unknown> | undefined;
      try {
        const pid = await entered.promise;
        decisions = 0;
        reading = read();
        readObserved = Promise.allSettled([reading]);
        assert({
          given:
            'opponent canonical erasure has cleared reports but not committed',
          should:
            'block the other debater read at that participant account fence',
          actual: await finishedOrBlockedBehind(reading, fixture.sql, pid, {
            now: performance.now,
            deadlineMs: 1000,
          }),
          expected: 'blocked',
        });
        finish.resolve();
        await closing;
        await assertRejects({
          given: 'opponent erasure committed while the reader waited',
          should:
            'refuse the former report instead of returning an earlier snapshot',
          code: 'NOT_FOUND',
          actual: () => reading!,
        });
        assert({
          given: 'an erased participant discovered after the account lock wait',
          should: 'return no private facts or read-policy callback',
          actual: decisions,
          expected: 0,
        });
      } finally {
        finish.resolve();
        clearTimeout(timeout);
        await Promise.all([closingObserved, readObserved]);
      }
    },
  );
});
